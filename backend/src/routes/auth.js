import express from "express";
import { z } from "zod";
import { config } from "../config/index.js";
import { hashPassword, verifyPassword, getDummyHash, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "../auth/passwords.js";
import { signAccessToken } from "../auth/tokens.js";
import {
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  recordFailedLogin,
  clearFailedLogins,
  isLocked,
  toPublicUser,
  deleteUser,
} from "../repositories/users.js";
import { issueRefreshToken, rotateRefreshToken, revokeFamily, findByRaw, revokeAllForUser } from "../repositories/refreshTokens.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimits.js";
import { deleteImagesForUser } from "../services/imageStore.js";

const GENERIC_LOGIN_ERROR = { error: "invalid_credentials", detail: "Invalid email or password." };
const REGISTER_ACCEPTED = {
  status: "accepted",
  detail: "If this email can be registered, the account is ready. You can now sign in.",
};

const emailSchema = z.string().trim().toLowerCase().max(254).email();
const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  preferred_language: z.string().min(2).max(8).optional(),
});
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });
const patchMeSchema = z
  .object({
    preferred_language: z.string().min(2).max(8).optional(),
    store_location_opt_in: z.boolean().optional(),
  })
  .strict();

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: config.auth.refreshTokenTtlDays * 86400 * 1000,
  };
}

function setRefreshCookie(res, raw) {
  res.cookie(config.auth.refreshCookieName, raw, refreshCookieOptions());
}

function clearRefreshCookie(res) {
  const { maxAge, ...opts } = refreshCookieOptions();
  res.clearCookie(config.auth.refreshCookieName, opts);
}

function sessionBody(user) {
  return {
    access_token: signAccessToken(user),
    token_type: "Bearer",
    expires_in: config.auth.accessTokenTtlSeconds,
    user: toPublicUser(user),
  };
}

export default function authRoutes(db) {
  const router = express.Router();
  const limiter = authLimiter();

  router.post("/register", limiter, validate(registerSchema), async (req, res, next) => {
    try {
      const { email, password, preferred_language } = req.validated.body;
      const lang = config.languages.includes(preferred_language) ? preferred_language : "en";
      const existing = await findUserByEmail(db, email);
      // Hash either way so the response time does not reveal whether the email exists.
      const passwordHash = await hashPassword(password);
      if (!existing) {
        try {
          await createUser(db, { email, passwordHash, role: "user", preferredLanguage: lang });
        } catch (err) {
          // unique violation from a concurrent registration -- same generic answer
          if (!/unique|duplicate/i.test(String(err.message))) throw err;
        }
      }
      return res.status(202).json(REGISTER_ACCEPTED);
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", limiter, validate(loginSchema), async (req, res, next) => {
    try {
      const { email, password } = req.validated.body;
      const user = await findUserByEmail(db, email);
      if (!user) {
        await verifyPassword(password, await getDummyHash());
        return res.status(401).json(GENERIC_LOGIN_ERROR);
      }
      if (isLocked(user)) {
        await verifyPassword(password, await getDummyHash());
        return res.status(401).json(GENERIC_LOGIN_ERROR);
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        await recordFailedLogin(db, user, {
          maxFailed: config.auth.maxFailedLogins,
          lockoutMinutes: config.auth.lockoutMinutes,
        });
        return res.status(401).json(GENERIC_LOGIN_ERROR);
      }
      await clearFailedLogins(db, user.id);
      const { raw } = await issueRefreshToken(db, user.id, { ttlDays: config.auth.refreshTokenTtlDays });
      setRefreshCookie(res, raw);
      return res.status(200).json(sessionBody(user));
    } catch (err) {
      next(err);
    }
  });

  router.post("/refresh", limiter, async (req, res, next) => {
    try {
      const raw = req.cookies?.[config.auth.refreshCookieName];
      const rotated = await rotateRefreshToken(db, raw, { ttlDays: config.auth.refreshTokenTtlDays });
      if (!rotated.ok) {
        clearRefreshCookie(res);
        if (rotated.reason === "reused") {
          console.warn(`[auth] refresh token reuse detected for user ${rotated.userId}; token family revoked.`);
        }
        return res.status(401).json({ error: "invalid_refresh", detail: "Please sign in again." });
      }
      const user = await findUserById(db, rotated.userId);
      if (!user) {
        clearRefreshCookie(res);
        return res.status(401).json({ error: "invalid_refresh", detail: "Please sign in again." });
      }
      setRefreshCookie(res, rotated.raw);
      return res.status(200).json(sessionBody(user));
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const raw = req.cookies?.[config.auth.refreshCookieName];
      const row = await findByRaw(db, raw);
      if (row) await revokeFamily(db, row.family_id);
      clearRefreshCookie(res);
      return res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", requireAuth, async (req, res, next) => {
    try {
      const user = await findUserById(db, req.user.id);
      if (!user) return res.status(401).json({ error: "unauthorized", detail: "Sign in required." });
      return res.json({ user: toPublicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/me", requireAuth, validate(patchMeSchema), async (req, res, next) => {
    try {
      const patch = { ...req.validated.body };
      if (patch.preferred_language && !config.languages.includes(patch.preferred_language)) {
        return res.status(400).json({ error: "validation_error", detail: "Unsupported language." });
      }
      if (patch.store_location_opt_in === false) {
        // opting out also removes any coordinates already stored
        await db("plots").where({ user_id: req.user.id }).update({ lat: null, lng: null });
      }
      const user = await updateUser(db, req.user.id, patch);
      return res.json({ user: toPublicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  // Real account deletion: user row, tokens, plots, scans (cascade) and stored images.
  router.delete("/me", requireAuth, async (req, res, next) => {
    try {
      await deleteImagesForUser(db, req.user.id);
      await revokeAllForUser(db, req.user.id);
      await deleteUser(db, req.user.id);
      clearRefreshCookie(res);
      return res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
