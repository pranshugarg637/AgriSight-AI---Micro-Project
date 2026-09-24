/* eslint-disable react-refresh/only-export-components */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";

function SetUser({ user, children }) {
  const auth = useAuth();
  useEffect(() => {
    auth._setUser(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (user && !auth.user) return null;
  return children;
}

/** Renders `ui` inside a router + AuthProvider (no network refresh on mount). */
export function renderWithProviders(ui, { route = "/", user = null } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider skipInitialRefresh>
        <SetUser user={user}>{ui}</SetUser>
      </AuthProvider>
    </MemoryRouter>
  );
}

export const DEMO_USER = { id: 1, email: "demo@example.com", role: "user", preferred_language: "en" };
