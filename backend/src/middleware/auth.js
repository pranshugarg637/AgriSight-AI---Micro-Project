import { verifyAccessToken } from "../auth/tokens.js";

function extractBearer(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/** Requires a valid, unexpired access token. Sets req.user = { id, role }. */
export function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: "unauthorized", detail: "Sign in required." });
  }
  try {
    const { userId, role } = verifyAccessToken(token);
    req.user = { id: userId, role };
    return next();
  } catch (err) {
    const expired = err && err.name === "TokenExpiredError";
    return res.status(401).json({
      error: expired ? "token_expired" : "unauthorized",
      detail: expired ? "Your session expired. Please refresh." : "Sign in required.",
    });
  }
}

/** Sets req.user when a valid token is present; never rejects. */
export function optionalAuth(req, res, next) {
  const token = extractBearer(req);
  if (token) {
    try {
      const { userId, role } = verifyAccessToken(token);
      req.user = { id: userId, role };
    } catch {
      /* ignore -- treated as a guest */
    }
  }
  next();
}

/** Must run after requireAuth. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthorized", detail: "Sign in required." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden", detail: "You do not have permission to do this." });
    }
    next();
  };
}
