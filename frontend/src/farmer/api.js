import { BACKEND_URL, parseResponse } from "../api/http";

/** Guest diagnosis -- no token, no cookies. */
export async function farmerPredict(file, language) {
  const form = new FormData();
  form.append("file", file, file.name || "leaf.jpg");
  form.append("language", language);
  const res = await fetch(`${BACKEND_URL}/api/farmer/predict`, { method: "POST", body: form });
  return parseResponse(res);
}

const bundles = new Map();
export async function getScriptBundle(lang) {
  if (bundles.has(lang)) return bundles.get(lang);
  const res = await fetch(`${BACKEND_URL}/api/farmer/audio-scripts/${lang}`);
  const data = await parseResponse(res);
  bundles.set(lang, data);
  return data;
}
export function clearScriptBundles() {
  bundles.clear();
}

async function getJson(path) {
  const res = await fetch(`${BACKEND_URL}${path}`);
  return parseResponse(res);
}
export const getShops = (lat, lng) => getJson(`/api/farmer/shops?lat=${lat}&lng=${lng}`);
export const getHelpIndex = () => getJson(`/api/farmer/help-centers/index`);
export const getHelpCenters = (state, district) =>
  getJson(`/api/farmer/help-centers?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district || "")}`);
export const geocodePlace = (q) => getJson(`/api/farmer/geocode?q=${encodeURIComponent(q)}`);

/** One-shot location with a timeout; never cached or stored by the app. */
export function getPositionOnce({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Object.assign(new Error("unsupported"), { code: "unsupported" }));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout, maximumAge: 0 }
    );
  });
}

export async function getQuestions(a, b, lang) {
  return getJson(`/api/farmer/questions?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&lang=${lang}`);
}

export async function refineDiagnosis(candidates, answers) {
  const res = await fetch(`${BACKEND_URL}/api/farmer/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates, answers }),
  });
  return parseResponse(res);
}

/** Merge a /refine answer into the original prediction (same shape for gating). */
export function applyRefinement(result, refined) {
  const alts = refined.candidates
    .filter((c) => c.class_key !== refined.class_key)
    .slice(0, 2)
    .map((c) => {
      const [crop, disease] = c.class_key.split("___");
      return { class_key: c.class_key, crop: crop.replace(/_/g, " "), disease: (disease || "").replace(/_/g, " "), confidence: c.probability };
    });
  return {
    ...result,
    class_key: refined.class_key,
    crop: refined.crop,
    diagnosis: refined.diagnosis,
    confidence: refined.confidence,
    confidence_level: refined.confidence_level,
    alternatives: alts,
    top_candidates: refined.candidates,
    question_pair: null,
    refined: true,
  };
}
