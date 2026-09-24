import { describe, it, expect, vi, afterEach } from "vitest";
import { assessFrame, laplacianVariance, leafPixelRatio, toGray, meanBrightness, DEFAULT_THRESHOLDS } from "../farmer/frameQuality";
import { createCaptureMachine, startAnalysisLoop } from "../farmer/captureMachine";

const W = 160;
const H = 120;

/** Fixture images as RGBA ImageData-like objects. */
function makeFrame(fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fn(x, y);
      const p = (y * W + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  return { data, width: W, height: H };
}
// textured green leaf filling the frame (veins every 4 px -> sharp edges)
const sharpLeaf = () => makeFrame((x, y) => ((x + y) % 8 < 4 ? [40, 150, 40] : [90, 200, 60]));
// same colours but smooth (no edges) -> "blurry"
const smoothLeaf = () => makeFrame((x) => [60, 150 + Math.round((x / W) * 30), 50]);
const darkLeaf = () => makeFrame((x, y) => ((x + y) % 8 < 4 ? [5, 25, 5] : [10, 35, 8]));
const greyWall = () => makeFrame((x, y) => ((x + y) % 8 < 4 ? [120, 120, 120] : [170, 170, 170]));
// leaf only in a small patch in the centre -> "come closer"
const smallLeaf = () =>
  makeFrame((x, y) => {
    const inLeaf = Math.abs(x - W / 2) < 18 && Math.abs(y - H / 2) < 14;
    if (!inLeaf) return (x + y) % 8 < 4 ? [120, 120, 120] : [170, 170, 170];
    return (x + y) % 8 < 4 ? [40, 150, 40] : [90, 200, 60];
  });

describe("frame quality metrics", () => {
  it("sharp textured leaf has higher Laplacian variance than a smooth one", () => {
    const a = sharpLeaf();
    const b = smoothLeaf();
    const va = laplacianVariance(toGray(a.data, W, H), W, H);
    const vb = laplacianVariance(toGray(b.data, W, H), W, H);
    expect(va).toBeGreaterThan(DEFAULT_THRESHOLDS.minSharpness);
    expect(vb).toBeLessThan(DEFAULT_THRESHOLDS.minSharpness);
  });

  it("leaf-likeness: green frame high, grey wall ~0", () => {
    expect(leafPixelRatio(sharpLeaf().data, W, H)).toBeGreaterThan(0.9);
    expect(leafPixelRatio(greyWall().data, W, H)).toBeLessThan(0.05);
  });

  it("brightness", () => {
    expect(meanBrightness(toGray(darkLeaf().data, W, H))).toBeLessThan(DEFAULT_THRESHOLDS.minBrightness);
  });

  it.each([
    ["good", sharpLeaf, null],
    ["dark", darkLeaf, "too_dark"],
    ["not a leaf", greyWall, "no_leaf"],
    ["too far", smallLeaf, "too_far"],
    ["blurry", smoothLeaf, "blurry"],
  ])("assessFrame(%s) -> %s", (_n, make, reason) => {
    const res = assessFrame(make());
    expect(res.reason).toBe(reason);
    expect(res.ok).toBe(reason === null);
  });

  it("detects motion between consecutive frames", () => {
    const a = assessFrame(sharpLeaf());
    const shifted = makeFrame((x, y) => ((x + y + 4) % 8 < 4 ? [40, 150, 40] : [90, 200, 60]));
    const b = assessFrame(shifted, a.gray);
    expect(b.reason).toBe("moving");
  });
});

describe("auto-capture state machine", () => {
  afterEach(() => vi.useRealTimers());
  const good = { ok: true, reason: null };
  const blurry = { ok: false, reason: "blurry" };

  it("captures only after N consecutive good frames", () => {
    const m = createCaptureMachine({ requiredGoodFrames: 3 });
    expect(m.onFrame(good).capture).toBe(false);
    expect(m.onFrame(good).capture).toBe(false);
    const third = m.onFrame(good);
    expect(third.capture).toBe(true);
    expect(third.prompt).toBe("captured");
    expect(m.state).toBe("captured");
    expect(m.onFrame(good).capture).toBe(false); // only once
  });

  it("a bad frame resets the counter", () => {
    const m = createCaptureMachine({ requiredGoodFrames: 3 });
    m.onFrame(good);
    m.onFrame(good);
    m.onFrame(blurry);
    expect(m.goodFrames).toBe(0);
    m.onFrame(good);
    m.onFrame(good);
    expect(m.onFrame(good).capture).toBe(true);
  });

  it("maps reasons to spoken guidance and rate-limits repeats (fake timers)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const m = createCaptureMachine({ promptCooldownMs: 4000 });
    expect(m.onFrame({ ok: false, reason: "too_dark" }).prompt).toBe("low_light");
    vi.advanceTimersByTime(1000);
    expect(m.onFrame({ ok: false, reason: "too_dark" }).prompt).toBeNull();
    vi.advanceTimersByTime(3500);
    expect(m.onFrame({ ok: false, reason: "too_dark" }).prompt).toBe("low_light");
    vi.advanceTimersByTime(2100);
    expect(m.onFrame({ ok: false, reason: "too_far" }).prompt).toBe("come_closer");
    expect(m.onFrame({ ok: false, reason: "moving" }).cue).toBe("hold_steady");
  });

  it("manual capture works once", () => {
    const m = createCaptureMachine();
    expect(m.forceCapture()).toBe(true);
    expect(m.forceCapture()).toBe(false);
  });

  it("analysis loop ticks at the given interval until stopped (fake timers)", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const stop = startAnalysisLoop(tick, 333);
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});
