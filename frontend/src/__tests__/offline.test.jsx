import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { toTensorData, softmax, postprocess, leafRatio128, energyScore } from "../offline/classifier";
import * as offline from "../offline/classifier";
import * as queue from "../offline/queue";
import * as farmerApi from "../farmer/api";
import { buildSpokenResult } from "../farmer/safetyGating";
import FarmerApp from "../farmer/FarmerApp";
import { renderWithProviders } from "../test-utils";

const META = {
  class_names: ["Tomato___Early_blight", "Tomato___Late_blight", "Tomato___healthy"],
  temperature: 1,
  high_confidence_threshold: 0.8,
  low_confidence_threshold: 0.6,
  model_version: "1.0.0",
  ood: null,
};

describe("offline classifier maths", () => {
  it("normalises RGBA to NCHW with ImageNet stats", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const t = toTensorData(rgba, 2, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(Array.from(t)).toEqual([1, -1, -1, 1, -1, 1, -1, 1, -1, -1, 1, 1]);
  });

  it("temperature softens the softmax without changing the argmax", () => {
    const hot = softmax([4, 1, 0], 1);
    const cool = softmax([4, 1, 0], 3);
    expect(cool[0]).toBeLessThan(hot[0]);
    expect(cool.indexOf(Math.max(...cool))).toBe(0);
    expect(energyScore([10, 0, 0])).toBeLessThan(energyScore([0.1, 0, 0]));
  });

  it("applies the same tiers as the server", () => {
    expect(postprocess([6, 0, 0], META).confidence_level).toBe("high");
    expect(postprocess([1.2, 0.2, -2], META).confidence_level).toBe("low");
    const u = postprocess([0.1, 0, 0.05], META);
    expect(u.confidence_level).toBe("unreliable");
    expect(u.unreliable_reason).toBe("low_confidence");
  });

  it("applies exported OOD thresholds", () => {
    const meta = { ...META, ood: { leaf_ratio_threshold: 0.3, energy_threshold: -5 } };
    expect(postprocess([12, 0, 0], meta, { leafRatio: 0.05 }).unreliable_reason).toBe("not_a_leaf");
    expect(postprocess([2, 1.9, 1.8], { ...meta, high_confidence_threshold: 0.3, low_confidence_threshold: 0.2 }, { leafRatio: 0.9 }).unreliable_reason).toBe("unsupported_crop");
  });

  it("marks results as offline with no evidence checked", () => {
    const r = postprocess([6, 0, 0], META);
    expect(r.offline).toBe(true);
    expect(r.retrieval_status).toBe("offline_not_checked");
    expect(r.class_key).toBe("Tomato___Early_blight");
  });

  it("leaf ratio matches the server heuristic on plain fixtures", () => {
    const make = (r, g, b) => {
      const a = new Uint8ClampedArray(128 * 128 * 4);
      for (let i = 0; i < a.length; i += 4) a.set([r, g, b, 255], i);
      return a;
    };
    expect(leafRatio128(make(60, 150, 40))).toBe(1);
    expect(leafRatio128(make(128, 128, 128))).toBe(0);
  });

  it("offline gating: announces offline and never speaks advice", () => {
    const bundle = { classes: { tomato_late_blight: { clips: { name: "n", safe_steps: "s", what_it_is: "w" }, sources: [{}] } } };
    const g = buildSpokenResult({ ...postprocess([0, 8, 0], META) }, bundle, { lang: "hi" });
    expect(g.playlist[0]).toBe("hi.prompt.offline_result");
    expect(g.playlist).toContain("hi.prompt.no_advice_found");
    expect(g.playlist).toContain("hi.prompt.visit_office");
    expect(g.playlist.some((k) => k.endsWith("safe_steps"))).toBe(false);
  });
});

describe("offline queue (IndexedDB)", () => {
  it("queues photos and flushes them when online, deleting sent ones", async () => {
    await queue.enqueuePhoto(new Blob(["a"]), "hi");
    await queue.enqueuePhoto(new Blob(["b"]), "en");
    expect((await queue.listQueued()).length).toBe(2);
    const predict = vi.fn().mockResolvedValueOnce({ diagnosis: "x" }).mockRejectedValueOnce(new Error("offline again"));
    const out = await queue.flushQueue(predict);
    expect(out[0].result).toEqual({ diagnosis: "x" });
    expect(out[1].error).toMatch(/offline again/);
    expect(predict.mock.calls[0][1]).toBe("hi");
    expect((await queue.listQueued()).length).toBe(1); // failed one stays queued
    await queue.removeQueued((await queue.listQueued())[0].id);
  });
});

describe("Farmer Mode offline branch", () => {
  const player = () => ({ play: vi.fn(() => Promise.resolve(true)), replay: vi.fn(), stop: vi.fn(), setBundle: vi.fn(), setCaptionListener: vi.fn() });
  beforeEach(() => {
    vi.restoreAllMocks();
    global.URL.createObjectURL = vi.fn(() => "blob:x");
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(farmerApi, "getScriptBundle").mockResolvedValue({ prompts: {}, classes: {}, available_clips: [], unreviewed: [] });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  });
  afterEach(() => Object.defineProperty(navigator, "onLine", { value: true, configurable: true }));

  it("uses the on-device model, queues the photo, and does not call the server", async () => {
    const predict = vi.spyOn(farmerApi, "farmerPredict");
    vi.spyOn(offline, "classifyOffline").mockResolvedValue(postprocess([0, 0.2, 0], META));
    const enq = vi.spyOn(queue, "enqueuePhoto").mockResolvedValue(1);
    const p = player();
    renderWithProviders(<FarmerApp player={p} />, { route: "/farmer" });
    fireEvent.change(screen.getByTestId("farmer-gallery"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText(/Could not tell from this photo/i)).toBeInTheDocument();
    expect(predict).not.toHaveBeenCalled();
    expect(enq).toHaveBeenCalled();
    await waitFor(() => expect(p.play.mock.calls.at(-1)[0][0]).toBe("en.prompt.offline_result"));
  });

  it("without an offline model: queues and says so", async () => {
    vi.spyOn(offline, "classifyOffline").mockRejectedValue(new Error("no model"));
    vi.spyOn(queue, "enqueuePhoto").mockResolvedValue(1);
    const p = player();
    renderWithProviders(<FarmerApp player={p} />, { route: "/farmer" });
    fireEvent.change(screen.getByTestId("farmer-gallery"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText(/saved on this phone/i)).toBeInTheDocument();
    expect(p.play).toHaveBeenCalledWith(["en.prompt.offline_queued"]);
  });
});
