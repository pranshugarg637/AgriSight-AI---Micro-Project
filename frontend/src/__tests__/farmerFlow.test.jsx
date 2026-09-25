import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import FarmerApp from "../farmer/FarmerApp";
import { ClipPlayer } from "../farmer/audioPlayer";
import * as farmerApi from "../farmer/api";
import { renderWithProviders } from "../test-utils";
import i18n from "../i18n";

const BUNDLE = (lang) => ({
  language: lang,
  prompts: { cannot_tell: "cannot tell", camera_denied: "camera denied" },
  classes: {
    tomato_late_blight: {
      class_key: "Tomato___Late_blight",
      clips: { name: lang === "hi" ? "टमाटर — पछेती झुलसा (लेट ब्लाइट)" : "Tomato: late blight", what_it_is: "w", safe_steps: "s" },
      sources: [{ file: "x.pdf" }],
    },
  },
  unreviewed: [],
  available_clips: [],
});

function fakePlayer() {
  return { play: vi.fn(() => Promise.resolve(true)), replay: vi.fn(), stop: vi.fn(), setBundle: vi.fn(), setCaptionListener: vi.fn() };
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:leaf");
  global.URL.revokeObjectURL = vi.fn();
  vi.spyOn(farmerApi, "getScriptBundle").mockImplementation(async (lang) => BUNDLE(lang));
});

describe("Farmer Mode flow", () => {
  it("falls back to photo upload and speaks a prompt when the camera is denied", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockRejectedValue(err) }, configurable: true });
    const player = fakePlayer();
    renderWithProviders(<FarmerApp player={player} />, { route: "/farmer" });
    fireEvent.click(screen.getByRole("button", { name: /Check a leaf/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Camera not available/i);
    expect(player.play).toHaveBeenCalledWith(["en.prompt.camera_denied"]);
    expect(screen.getByRole("button", { name: /Choose a photo/i })).toBeInTheDocument();
  });

  it("falls back when getUserMedia is not supported at all", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    const player = fakePlayer();
    renderWithProviders(<FarmerApp player={player} />, { route: "/farmer" });
    fireEvent.click(screen.getByRole("button", { name: /Check a leaf/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Camera not available/i);
  });

  it("gallery photo -> guest predict -> spoken high-confidence result -> shopkeeper card in two languages without products", async () => {
    await i18n.changeLanguage("hi");
    const predict = vi.spyOn(farmerApi, "farmerPredict").mockResolvedValue({
      class_key: "Tomato___Late_blight",
      crop: "Tomato",
      diagnosis: "Late blight",
      confidence: 0.93,
      confidence_level: "high",
      retrieval_status: "success",
      alternatives: [],
      gradcam_image_base64: "ZmFrZQ==",
    });
    const player = fakePlayer();
    renderWithProviders(<FarmerApp player={player} />, { route: "/farmer" });
    await waitFor(() => expect(farmerApi.getScriptBundle).toHaveBeenCalledWith("hi"));
    const file = new File(["x"], "leaf.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("farmer-gallery"), { target: { files: [file] } });
    await waitFor(() => expect(predict).toHaveBeenCalledWith(file, "hi", expect.any(Function)));
    expect(await screen.findByText("टमाटर — पछेती झुलसा (लेट ब्लाइट)")).toBeInTheDocument();
    await waitFor(() => expect(player.play).toHaveBeenCalledWith(expect.arrayContaining(["hi.tomato_late_blight.safe_steps"])));

    fireEvent.click(screen.getByRole("button", { name: /फिर से सुनें/ }));
    expect(player.replay).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /दुकानदार को दिखाएँ/ }));
    const card = screen.getByRole("dialog");
    expect(card).toHaveTextContent("Tomato: late blight");
    expect(card).toHaveTextContent("टमाटर — पछेती झुलसा");
    expect(card).toHaveTextContent(/No product is recommended/);
    expect(card.textContent).not.toMatch(/fungicide|mancozeb|spray \d/i);
  });

  it("unreliable result never shows or speaks a disease name", async () => {
    vi.spyOn(farmerApi, "farmerPredict").mockResolvedValue({
      class_key: "Tomato___Late_blight",
      crop: "Tomato",
      diagnosis: "Late blight",
      confidence: 0.3,
      confidence_level: "unreliable",
      unreliable_reason: "not_a_leaf",
      retrieval_status: "skipped_low_confidence",
      alternatives: [],
    });
    const player = fakePlayer();
    renderWithProviders(<FarmerApp player={player} />, { route: "/farmer" });
    await waitFor(() => expect(farmerApi.getScriptBundle).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("farmer-gallery"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText(/Could not tell from this photo/i)).toBeInTheDocument();
    expect(screen.queryByText(/late blight/i)).not.toBeInTheDocument();
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    const spoken = player.play.mock.calls.at(-1)[0];
    expect(spoken.some((k) => k.includes("late_blight"))).toBe(false);
    expect(screen.getByRole("button", { name: /Agriculture office near me/i })).toBeInTheDocument();
  });

  it("a 422 (unusable photo) is treated as cannot-tell", async () => {
    vi.spyOn(farmerApi, "farmerPredict").mockRejectedValue(Object.assign(new Error("blurry"), { status: 422 }));
    renderWithProviders(<FarmerApp player={fakePlayer()} />, { route: "/farmer" });
    fireEvent.change(screen.getByTestId("farmer-gallery"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText(/Could not tell from this photo/i)).toBeInTheDocument();
  });
});

describe("ClipPlayer", () => {
  it("plays pre-generated clips when available", async () => {
    const audios = [];
    const player = new ClipPlayer({
      bundle: { prompts: { a: "A" }, classes: {}, available_clips: ["en.prompt.a"] },
      createAudio: () => {
        const a = { play: () => Promise.resolve().then(() => a.onended()), pause: vi.fn() };
        audios.push(a);
        return a;
      },
      speech: { speak: vi.fn(), cancel: vi.fn() },
      reportFallback: vi.fn(),
      baseUrl: "http://api",
    });
    await player.play(["en.prompt.a"]);
    expect(audios[0].src).toBe("http://api/api/farmer/audio/en.prompt.a");
    expect(player.speech.speak).not.toHaveBeenCalled();
  });

  it("falls back to Web Speech (logged + reported) when a clip is missing", async () => {
    global.SpeechSynthesisUtterance = function (text) {
      this.text = text;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const speech = { speak: vi.fn((u) => u.onend()), cancel: vi.fn() };
    const report = vi.fn();
    const player = new ClipPlayer({
      bundle: { prompts: { b: "Bee text" }, classes: {}, available_clips: [] },
      speech,
      reportFallback: report,
      speechLang: "hi-IN",
    });
    await player.play(["hi.prompt.b"]);
    expect(speech.speak).toHaveBeenCalled();
    expect(speech.speak.mock.calls[0][0].text).toBe("Bee text");
    expect(speech.speak.mock.calls[0][0].lang).toBe("hi-IN");
    expect(report).toHaveBeenCalledWith("hi.prompt.b");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Web Speech fallback"));
  });
});
