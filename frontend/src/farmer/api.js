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
