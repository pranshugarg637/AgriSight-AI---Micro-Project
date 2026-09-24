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
