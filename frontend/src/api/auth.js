import { BACKEND_URL, parseResponse, tokenStore, authJson, authFetch } from "./http";

export async function register({ email, password, preferredLanguage }) {
  const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password, preferred_language: preferredLanguage }),
  });
  return parseResponse(res);
}

export async function login({ email, password }) {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const data = await parseResponse(res);
  tokenStore.set(data.access_token);
  return data;
}

export async function logout() {
  try {
    await fetch(`${BACKEND_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
  } finally {
    tokenStore.clear();
  }
}

export const getMe = () => authJson("/api/auth/me");
export const updateMe = (patch) => authJson("/api/auth/me", { method: "PATCH", body: patch });
export async function deleteAccount() {
  const res = await authFetch("/api/auth/me", { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseResponse(res);
  tokenStore.clear();
}
