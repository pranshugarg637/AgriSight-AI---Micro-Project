import FormData from "form-data";
import fetch from "node-fetch";
import { config } from "../config/index.js";

/**
 * The only way the backend talks to the ML service. Always sends the shared
 * X-Internal-Token so the ML service can reject anything else.
 */
export function internalHeaders(extra = {}) {
  const headers = { ...extra };
  if (config.mlInternalToken) headers["X-Internal-Token"] = config.mlInternalToken;
  return headers;
}

export async function mlFetch(pathname, { method = "GET", body, headers = {}, timeoutMs = config.requestTimeoutMs, signal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  try {
    return await fetch(`${config.mlServiceUrl}${pathname}`, {
      method,
      body,
      headers: internalHeaders(headers),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

export function buildImageForm(file, fields = {}) {
  const formData = new FormData();
  formData.append("file", file.buffer, { filename: file.originalname || "leaf.jpg", contentType: file.mimetype });
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) formData.append(k, String(v));
  }
  return formData;
}

/** POST an image to an ML endpoint and return { status, data }. */
export async function mlPostImage(pathname, file, fields = {}) {
  const formData = buildImageForm(file, fields);
  const response = await mlFetch(pathname, { method: "POST", body: formData, headers: formData.getHeaders() });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, ok: response.ok, data };
}

export async function mlJson(pathname, { method = "GET", body } = {}) {
  const response = await mlFetch(pathname, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, ok: response.ok, data };
}
