/**
 * HTTP layer with in-memory access token + silent refresh.
 * - The access token lives only in memory (never localStorage).
 * - The refresh token is an httpOnly cookie the JS cannot read; it is sent
 *   only to /api/auth/* (cookie path) with credentials: "include".
 * - On a 401 "token_expired", one refresh is attempted (single-flight) and
 *   the request retried once.
 */
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

let accessToken = null;
let onSessionChange = () => {};
let refreshInFlight = null;

export const tokenStore = {
  get: () => accessToken,
  set: (token) => {
    accessToken = token;
  },
  clear: () => {
    accessToken = null;
  },
  onChange: (fn) => {
    onSessionChange = fn;
  },
};

export async function parseResponse(response) {
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

/** POST /api/auth/refresh -- returns the session body or null. */
export async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) {
          tokenStore.clear();
          onSessionChange(null);
          return null;
        }
        const data = await res.json();
        tokenStore.set(data.access_token);
        onSessionChange(data);
        return data;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** fetch() with Bearer token and one silent-refresh retry on expiry. */
export async function authFetch(path, options = {}, { retry = true } = {}) {
  const headers = new Headers(options.headers || {});
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
  if (response.status === 401 && retry) {
    const session = await refreshSession();
    if (session) return authFetch(path, options, { retry: false });
  }
  return response;
}

export async function authJson(path, { method = "GET", body } = {}) {
  const res = await authFetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  return parseResponse(res);
}
