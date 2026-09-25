/**
 * Offline (on-device) classification for Farmer Mode (Step 8).
 *
 * Runs the ONNX export of the SAME trained model in the browser with
 * onnxruntime-web (WASM). Applies the same temperature, confidence
 * thresholds and OOD thresholds exported in model_web.json, so the same
 * safety gating holds offline. There is no retrieval/LLM offline: results
 * carry retrieval_status "offline_not_checked", which the gating treats as
 * "no reliable advice -> visit the agriculture office".
 */
const MODEL_BASE = "/models";
let loaded = null;

export async function isOfflineModelAvailable() {
  try {
    const res = await fetch(`${MODEL_BASE}/model_web.json`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadOfflineModel({ preferInt8 = false } = {}) {
  if (loaded) return loaded;
  const meta = await (await fetch(`${MODEL_BASE}/model_web.json`)).json();
  // WASM-only build; Vite emits the .wasm as a hashed asset next to the bundle
  // (cached by the service worker like any other /assets/ file).
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1; // no cross-origin isolation needed
  const file = preferInt8 && meta.files?.int8 ? meta.files.int8.file : meta.default_file;
  const session = await ort.InferenceSession.create(`${MODEL_BASE}/${file}`, { executionProviders: ["wasm"] });
  loaded = { ort, session, meta, file };
  return loaded;
}

/** RGBA (already resized to size x size) -> NCHW normalised Float32Array. */
export function toTensorData(rgba, size, mean, std) {
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    out[i] = (rgba[p] / 255 - mean[0]) / std[0];
    out[plane + i] = (rgba[p + 1] / 255 - mean[1]) / std[1];
    out[2 * plane + i] = (rgba[p + 2] / 255 - mean[2]) / std[2];
  }
  return out;
}

export function softmax(logits, temperature = 1) {
  const z = Array.from(logits, (v) => v / temperature);
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function energyScore(logits, temperature = 1) {
  const z = Array.from(logits, (v) => v / temperature);
  const m = Math.max(...z);
  return -temperature * (m + Math.log(z.reduce((a, v) => a + Math.exp(v - m), 0)));
}

/** Same colour heuristic as ml-service/app/inference/ood.py (128x128, centre 60%). */
export function leafRatio128(rgba, size = 128, centre = 0.6) {
  const m = Math.floor((size * (1 - centre)) / 2);
  let plant = 0;
  let total = 0;
  for (let y = m; y < size - m; y++) {
    for (let x = m; x < size - m; x++) {
      const p = (y * size + x) * 4;
      const r = rgba[p] / 255;
      const g = rgba[p + 1] / 255;
      const b = rgba[p + 2] / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const d = mx - mn;
      const s = mx > 0 ? d / mx : 0;
      let h = 0;
      const dd = Math.max(d, 1e-6);
      if (mx === r) h = 60 * ((((g - b) / dd) % 6) + 6) % 360;
      else if (mx === g) h = 60 * ((b - r) / dd + 2);
      else h = 60 * ((r - g) / dd + 4);
      if (mx >= 0.12 && s >= 0.18 && h >= 10 && h <= 170) plant++;
      total++;
    }
  }
  return total ? plant / total : 0;
}

const split = (k) => {
  const [crop, disease = ""] = String(k).split("___");
  return { crop: crop.replace(/_/g, " ").trim(), disease: disease.replace(/_/g, " ").trim() };
};

/** logits -> server-shaped result, with the same tiers + OOD gate. */
export function postprocess(logits, meta, { leafRatio = null } = {}) {
  const probs = softmax(logits, meta.temperature || 1);
  const order = probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const [topP, topI] = order[0];
  const classKey = meta.class_names[topI];
  let level = topP >= meta.high_confidence_threshold ? "high" : topP >= meta.low_confidence_threshold ? "low" : "unreliable";
  let reason = level === "unreliable" ? "low_confidence" : null;
  const ood = meta.ood || {};
  if (ood.leaf_ratio_threshold != null && leafRatio != null && leafRatio < ood.leaf_ratio_threshold) {
    level = "unreliable";
    reason = "not_a_leaf";
  } else if (ood.energy_threshold != null && energyScore(logits, meta.temperature || 1) > ood.energy_threshold) {
    level = "unreliable";
    reason = "unsupported_crop";
  }
  const { crop, disease } = split(classKey);
  return {
    class_key: classKey,
    crop,
    diagnosis: disease,
    confidence: topP,
    confidence_level: level,
    is_reliable: level === "high",
    unreliable_reason: reason,
    alternatives: order.slice(1, 3).filter(([p]) => p >= 0.1).map(([p, i]) => ({ class_key: meta.class_names[i], ...split(meta.class_names[i]), confidence: p })),
    top_candidates: order.slice(0, 5).map(([p, i]) => ({ class_key: meta.class_names[i], ...split(meta.class_names[i]), probability: p })),
    retrieval_status: "offline_not_checked",
    sources: [],
    explanation: null,
    question_pair: null,
    offline: true,
    model_version: meta.model_version,
    calibrated: Boolean(meta.calibrated),
  };
}

async function imageToRgba(file, size) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

export async function classifyOffline(file) {
  const { ort, session, meta } = await loadOfflineModel();
  const size = meta.image_size;
  const rgba = await imageToRgba(file, size);
  const input = new ort.Tensor("float32", toTensorData(rgba, size, meta.mean, meta.std), [1, 3, size, size]);
  const out = await session.run({ input });
  const leaf = leafRatio128(await imageToRgba(file, 128));
  return postprocess(out.logits.data, meta, { leafRatio: leaf });
}
