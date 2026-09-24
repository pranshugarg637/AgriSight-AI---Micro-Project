import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import App from "../App";
import { AuthProvider } from "../auth/AuthContext";
import { tokenStore, authFetch } from "../api/http";

function renderApp(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider skipInitialRefresh>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  tokenStore.clear();
});

describe("landing + auth", () => {
  it("shows the two big choices on the landing screen", () => {
    renderApp("/");
    expect(screen.getByRole("link", { name: /I'm a farmer/i })).toHaveAttribute("href", "/farmer");
    expect(screen.getByRole("link", { name: /Sign in \/ Register/i })).toHaveAttribute("href", "/login");
  });

  it("redirects anonymous users from /account to the login page", async () => {
    renderApp("/account");
    expect(await screen.findByRole("heading", { name: /Sign in/i })).toBeInTheDocument();
  });

  it("logs in, stores the access token only in memory and opens the account", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/api/auth/login")) {
        return jsonResponse(200, {
          access_token: "tok-1",
          token_type: "Bearer",
          expires_in: 900,
          user: { id: 1, email: "a@b.com", role: "user", preferred_language: "en" },
        });
      }
      return jsonResponse(404, { error: "not_found" });
    });
    renderApp("/login");
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "long-enough-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
    expect(await screen.findByRole("button", { name: /Diagnose specimen/i })).toBeInTheDocument();
    expect(tokenStore.get()).toBe("tok-1");
    expect(window.localStorage.getItem("tok-1")).toBeNull();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
  });

  it("shows a generic error on failed login", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(401, { error: "invalid_credentials" }));
    renderApp("/login");
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Invalid email or password/i);
  });

  it("register validates password length client-side", () => {
    renderApp("/register");
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 10/i);
  });
});

describe("silent refresh", () => {
  it("retries once after refreshing an expired access token", async () => {
    tokenStore.set("expired");
    const seen = [];
    vi.spyOn(global, "fetch").mockImplementation(async (url, init = {}) => {
      const u = String(url);
      seen.push([u, new Headers(init.headers || {}).get("Authorization")]);
      if (u.endsWith("/api/auth/refresh")) {
        return jsonResponse(200, { access_token: "fresh", expires_in: 900, user: { id: 1, role: "user" } });
      }
      const auth = new Headers(init.headers || {}).get("Authorization");
      if (auth === "Bearer fresh") return jsonResponse(200, { ok: true });
      return jsonResponse(401, { error: "token_expired" });
    });
    const res = await authFetch("/api/v2/plots");
    expect(res.status).toBe(200);
    expect(seen.map((s) => s[0].split("/api")[1])).toEqual(["/v2/plots", "/auth/refresh", "/v2/plots"]);
    expect(seen[2][1]).toBe("Bearer fresh");
  });

  it("does not loop when the refresh itself fails", async () => {
    tokenStore.set("expired");
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(401, { error: "token_expired" }));
    const res = await authFetch("/api/v2/plots");
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + one refresh attempt
    expect(tokenStore.get()).toBeNull();
  });
});

describe("role-guarded routes", () => {
  it("ProtectedRoute blocks users without the role", async () => {
    const { default: ProtectedRoute } = await import("../auth/ProtectedRoute");
    const { renderWithProviders, DEMO_USER } = await import("../test-utils");
    renderWithProviders(
      <Routes>
        <Route
          path="/x"
          element={
            <ProtectedRoute roles={["expert"]}>
              <p>secret</p>
            </ProtectedRoute>
          }
        />
      </Routes>,
      { route: "/x", user: DEMO_USER }
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/permission/i));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
