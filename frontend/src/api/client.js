import { BACKEND_URL, ApiError, parseResponse, authFetch } from "./http";

/**
 * Account-mode diagnosis (authenticated). `options.language` asks the ML
 * service for a translated explanation; `options.plotId` attaches the scan.
 */
export async function predictDisease(file, options = {}) {
  const formData = new FormData();
  formData.append("file", file);
  if (options.language) formData.append("language", options.language);
  if (options.plotId) formData.append("plot_id", String(options.plotId));
  if (options.followupOf) formData.append("followup_of", String(options.followupOf));

  const response = await authFetch("/api/predict", { method: "POST", body: formData });
  return parseResponse(response);
}

export async function getHealth() {
  const response = await fetch(`${BACKEND_URL}/api/health`);
  return parseResponse(response);
}

export async function getModelStatus() {
  const response = await fetch(`${BACKEND_URL}/api/model-status`);
  return parseResponse(response);
}

export async function getKnowledgeBaseStatus() {
  const response = await fetch(`${BACKEND_URL}/api/knowledge-base-status`);
  return parseResponse(response);
}

export async function getPredictionHistory(limit = 100) {
  const response = await fetch(`${BACKEND_URL}/api/analytics/history?limit=${limit}`);
  return parseResponse(response);
}

export { ApiError };
