import { BACKEND_URL } from "../api/http";
import { loadOfflineModel } from "./classifier";

/** Registers the service worker (production builds only). */
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[pwa] service worker registration failed", err));
  });
}

/**
 * Asks the service worker to cache everything Farmer Mode needs offline for
 * one language: its audio scripts + clips, the ONNX model and the WASM runtime.
 * Opt-in (a button) because it downloads ~25 MB (fp32 model 9 MB + WASM 14 MB).
 */
export async function cacheForOffline(bundle, lang) {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg?.active) return false;
  let modelFiles = [];
  try {
    // Loading the model once while online pulls the WASM runtime and the
    // model through the service worker, which keeps them (cache-first).
    const { meta } = await loadOfflineModel();
    modelFiles = ["/models/model_web.json", `/models/${meta.default_file}`];
  } catch {
    modelFiles = [];
  }
  const urls = [
    `${BACKEND_URL}/api/farmer/audio-scripts/${lang}`,
    ...(bundle?.available_clips || []).map((k) => `${BACKEND_URL}/api/farmer/audio/${k}`),
    ...modelFiles,
  ];
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(Boolean(e.data?.ok) && modelFiles.length > 0);
    reg.active.postMessage({ type: "CACHE_URLS", urls }, [channel.port2]);
    setTimeout(() => resolve(false), 120000);
  });
}
