import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { streamPrediction } from "../api/sse";
import * as apiClient from "../api/client";
import DiagnosePage from "../pages/account/DiagnosePage";
import { renderWithProviders, DEMO_USER } from "../test-utils";

function sseResponse(blocks) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      // split across chunks on purpose
      const text = blocks.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
      c.enqueue(enc.encode(text.slice(0, 17)));
      c.enqueue(enc.encode(text.slice(17)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:x");
});

describe("Server-Sent Events", () => {
  it("parses stage events across chunk boundaries and returns the result", async () => {
    const stages = [];
    const res = await streamPrediction(
      sseResponse([
        ["stage", { stage: "validate", status: "start" }],
        ["stage", { stage: "classify", status: "done" }],
        ["result", { diagnosis: "Late blight" }],
      ]),
      (e) => stages.push(`${e.stage}:${e.status}`)
    );
    expect(stages).toEqual(["validate:start", "classify:done"]);
    expect(res.diagnosis).toBe("Late blight");
  });

  it("turns an error event into an ApiError", async () => {
    await expect(streamPrediction(sseResponse([["error", { status_code: 422, detail: "blurry" }]]))).rejects.toMatchObject({
      status: 422,
      message: "blurry",
    });
  });

  it("the Diagnose page trail follows real events (no timer)", async () => {
    let push;
    let finish;
    vi.spyOn(apiClient, "predictDisease").mockImplementation((file, opts) => {
      push = opts.onStage;
      return new Promise((r) => (finish = r));
    });
    const { container } = renderWithProviders(<DiagnosePage />, { user: DEMO_USER });
    fireEvent.change(screen.getByLabelText(/Upload a leaf photo/i), { target: { files: [new File(["x"], "l.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: /Diagnose specimen/i }));
    await waitFor(() => expect(push).toBeTypeOf("function"));
    act(() => push({ stage: "retrieve", status: "start" }));
    expect(container.querySelector(".trail__tag--active")).toHaveTextContent("Find evidence");
    expect(screen.getByText("Find evidence…")).toBeInTheDocument();
    act(() => push({ stage: "translate", status: "skipped" }));
    await act(async () => finish({ diagnosis: "Late blight", crop: "Tomato", confidence: 0.9, confidence_level: "high", alternatives: [], sources: [], retrieval_status: "success" }));
    expect(await screen.findByRole("heading", { name: "Late blight" })).toBeInTheDocument();
  });
});
