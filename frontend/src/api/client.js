const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function handleResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    // non-JSON response
  }
  if (!response.ok) {
    const detail = data?.detail || data?.error || "Something went wrong. Please try again.";
    throw new ApiError(detail, response.status, data);
  }
  return data;
}

export async function predictDisease(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${BACKEND_URL}/api/predict`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(response);
}

export async function getHealth() {
  const response = await fetch(`${BACKEND_URL}/api/health`);
  return handleResponse(response);
}

export async function getModelStatus() {
  const response = await fetch(`${BACKEND_URL}/api/model-status`);
  return handleResponse(response);
}

export async function getKnowledgeBaseStatus() {
  const response = await fetch(`${BACKEND_URL}/api/knowledge-base-status`);
  return handleResponse(response);
}

export async function getPredictionHistory(limit = 100) {
  const response = await fetch(`${BACKEND_URL}/api/analytics/history?limit=${limit}`);
  return handleResponse(response);
}

export { ApiError };
