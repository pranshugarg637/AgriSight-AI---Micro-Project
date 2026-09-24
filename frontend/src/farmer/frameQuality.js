/**
 * Cheap, on-device frame checks used to decide WHEN to take a photo.
 * They never diagnose anything -- the server does that on one still photo.
 * All thresholds are heuristics for a ~160x120 analysis frame; tune them in
 * DEFAULT_THRESHOLDS (documented in docs/architecture.md).
 */
export const ANALYSIS_WIDTH = 160;
export const ANALYSIS_HEIGHT = 120;

export const DEFAULT_THRESHOLDS = {
  minBrightness: 55, // 0..255 mean luma
  minSharpness: 60, // variance of the Laplacian
  minLeafRatio: 0.35, // plant-coloured share of the centre region
  closerLeafRatio: 0.12, // below this: no leaf at all; between: "come closer"
  maxMotion: 12, // mean abs luma difference between consecutive frames
};

export function toGray(rgba, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return gray;
}

export function meanBrightness(gray) {
  let s = 0;
  for (let i = 0; i < gray.length; i++) s += gray[i];
  return gray.length ? s / gray.length : 0;
}

/** Variance of the 4-neighbour Laplacian (higher = sharper). */
export function laplacianVariance(gray, width, height) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function isPlantPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  if (v < 0.12 || s < 0.18) return false;
  let h;
  const d = max - min;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  // greens and yellows (healthy tissue) plus browns (lesions)
  return h >= 10 && h <= 170;
}

/** Share of plant-coloured pixels in the central region (default: middle 60%). */
export function leafPixelRatio(rgba, width, height, centre = 0.6) {
  const x0 = Math.floor((width * (1 - centre)) / 2);
  const y0 = Math.floor((height * (1 - centre)) / 2);
  const x1 = width - x0;
  const y1 = height - y0;
  let plant = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * width + x) * 4;
      if (isPlantPixel(rgba[p], rgba[p + 1], rgba[p + 2])) plant++;
      total++;
    }
  }
  return total ? plant / total : 0;
}

export function frameDifference(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * Assess one analysis frame. Returns { ok, reason, metrics, gray } where
 * reason (first failing check) is one of:
 *   "too_dark" | "no_leaf" | "too_far" | "blurry" | "moving" | null
 */
export function assessFrame({ data, width, height }, previousGray = null, t = DEFAULT_THRESHOLDS) {
  const gray = toGray(data, width, height);
  const metrics = {
    brightness: meanBrightness(gray),
    sharpness: laplacianVariance(gray, width, height),
    leafRatio: leafPixelRatio(data, width, height),
    motion: previousGray ? frameDifference(gray, previousGray) : 0,
  };
  let reason = null;
  if (metrics.brightness < t.minBrightness) reason = "too_dark";
  else if (metrics.leafRatio < t.closerLeafRatio) reason = "no_leaf";
  else if (metrics.leafRatio < t.minLeafRatio) reason = "too_far";
  else if (metrics.sharpness < t.minSharpness) reason = "blurry";
  else if (metrics.motion > t.maxMotion) reason = "moving";
  return { ok: reason === null, reason, metrics, gray };
}
