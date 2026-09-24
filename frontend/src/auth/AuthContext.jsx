import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { tokenStore, refreshSession } from "../api/http";
import * as authApi from "../api/auth";

const AuthContext = createContext(null);

/**
 * Session state. On mount it tries a silent refresh (the httpOnly refresh
 * cookie survives page reloads; the access token does not). While signed
 * in, the access token is refreshed shortly before it expires.
 */
export function AuthProvider({ children, skipInitialRefresh = false }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(skipInitialRefresh ? "anonymous" : "loading");
  const timer = useRef(null);

  const schedule = useCallback((expiresIn) => {
    clearTimeout(timer.current);
    if (!expiresIn) return;
    const ms = Math.max(10, expiresIn - 60) * 1000;
    timer.current = setTimeout(() => refreshSession(), ms);
  }, []);

  const applySession = useCallback(
    (session) => {
      if (session && session.user) {
        setUser(session.user);
        setStatus("authenticated");
        schedule(session.expires_in);
      } else {
        setUser(null);
        setStatus("anonymous");
        clearTimeout(timer.current);
      }
    },
    [schedule]
  );

  useEffect(() => {
    tokenStore.onChange(applySession);
    if (!skipInitialRefresh) {
      refreshSession().then((s) => {
        if (!s) applySession(null);
      });
    }
    return () => clearTimeout(timer.current);
  }, [applySession, skipInitialRefresh]);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === "authenticated",
      async login(credentials) {
        const session = await authApi.login(credentials);
        applySession(session);
        return session.user;
      },
      async logout() {
        await authApi.logout();
        applySession(null);
      },
      async register(data) {
        return authApi.register(data);
      },
      async updateProfile(patch) {
        const { user: updated } = await authApi.updateMe(patch);
        setUser(updated);
        return updated;
      },
      async deleteAccount() {
        await authApi.deleteAccount();
        applySession(null);
      },
      // test / storybook helper
      _setUser: (u) => {
        setUser(u);
        setStatus(u ? "authenticated" : "anonymous");
      },
    }),
    [user, status, applySession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
