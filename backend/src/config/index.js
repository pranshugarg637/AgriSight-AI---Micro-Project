import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(__dirname, "../..");
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..");

// backend/.env (optional, backend-only overrides) first, then the shared root .env.
// dotenv never overrides variables that are already set (e.g. by tests or Docker).
dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};
const int = (name, fallback) => parseInt(env(name, String(fallback)), 10);
const float = (name, fallback) => parseFloat(env(name, String(fallback)));
const bool = (name, fallback) => {
  const v = env(name, undefined);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};
const resolvePath = (p) => (path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p));

const nodeEnv = env("NODE_ENV", "development");
const appEnv = env("ENV", nodeEnv === "production" ? "production" : nodeEnv);
const isProduction = appEnv === "production";
const isTest = nodeEnv === "test";

/**
 * Secrets: fail fast in production, generate an ephemeral value in dev/test
 * (with a loud warning) so a fresh checkout still starts.
 */
function secret(name, { minLength = 32 } = {}) {
  const value = env(name, undefined);
  if (value && value.length >= minLength) return value;
  if (isProduction) {
    throw new Error(
      `[config] ${name} must be set (min ${minLength} chars) when ENV=production. Refusing to start.`
    );
  }
  if (value) return value; // short dev secret: allowed outside production
  if (!isTest) {
    console.warn(
      `[config] WARNING: ${name} is not set. Using a random per-process value (dev only). ` +
        "Sessions will not survive a restart. Set it in .env."
    );
  }
  return crypto.randomBytes(48).toString("base64url");
}

const dbClient = env("DB_CLIENT", "better-sqlite3");

export const config = {
  env: appEnv,
  isProduction,
  isTest,
  port: parseInt(env("BACKEND_PORT", "5000"), 10),
  // getter: read lazily so tests/containers can point it elsewhere after import
  get mlServiceUrl() {
    return env("ML_SERVICE_URL", "http://localhost:8000");
  },
  mlInternalToken: env("ML_INTERNAL_TOKEN", undefined) || (isProduction ? secret("ML_INTERNAL_TOKEN", { minLength: 24 }) : ""),
  maxUploadSizeMb: float("MAX_IMAGE_SIZE_MB", 8),
  farmerMaxUploadSizeMb: float("FARMER_MAX_IMAGE_SIZE_MB", 4),
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  requestTimeoutMs: int("ML_REQUEST_TIMEOUT_MS", 180000),
  trustProxy: env("TRUST_PROXY", "loopback"),

  db: {
    client: dbClient,
    // SQLite file (dev) -- ":memory:" is allowed for tests.
    filename: env("DB_FILENAME", "backend/data/agrisight.sqlite3"),
    // Postgres connection string (Compose / production), e.g. postgres://user:pass@db:5432/agrisight
    url: env("DATABASE_URL", ""),
  },

  auth: {
    jwtSecret: secret("JWT_SECRET"),
    jwtIssuer: env("JWT_ISSUER", "agrisight"),
    accessTokenTtlSeconds: int("ACCESS_TOKEN_TTL_SECONDS", 900),
    refreshTokenTtlDays: int("REFRESH_TOKEN_TTL_DAYS", 7),
    refreshCookieName: env("REFRESH_COOKIE_NAME", "agrisight_rt"),
    cookieSecure: bool("COOKIE_SECURE", true),
    bcryptCost: int("BCRYPT_COST", 12),
    maxFailedLogins: int("AUTH_MAX_FAILED_LOGINS", 5),
    lockoutMinutes: int("AUTH_LOCKOUT_MINUTES", 15),
    rateLimitWindowMs: int("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
    rateLimitMax: int("AUTH_RATE_LIMIT_MAX", 20),
  },

  rateLimits: {
    predictPerMinute: int("PREDICT_RATE_LIMIT_PER_MIN", 20),
    farmerPredictPerMinute: int("FARMER_PREDICT_RATE_LIMIT_PER_MIN", 6),
    farmerGeneralPerMinute: int("FARMER_RATE_LIMIT_PER_MIN", 60),
  },

  languages: env("SUPPORTED_LANGUAGES", "en,hi")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  storage: {
    imageDir: resolvePath(env("IMAGE_STORE_DIR", "backend/data/images")),
    imageRetentionDays: int("IMAGE_RETENTION_DAYS", 180),
    storeFarmerImages: bool("STORE_FARMER_IMAGES", false),
  },

  audio: {
    scriptsDir: resolvePath(env("AUDIO_SCRIPTS_DIR", "audio_scripts")),
    clipsDir: resolvePath(env("AUDIO_CLIPS_DIR", "audio_clips")),
  },

  help: {
    shopProvider: env("SHOP_PROVIDER", "overpass"),
    overpassUrl: env("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
    shopSearchRadiusM: int("SHOP_SEARCH_RADIUS_M", 15000),
    shopCacheTtlSeconds: int("SHOP_CACHE_TTL_SECONDS", 24 * 3600),
    shopMaxResults: int("SHOP_MAX_RESULTS", 10),
    providerTimeoutMs: int("SHOP_PROVIDER_TIMEOUT_MS", 15000),
    providerUserAgent: env("PROVIDER_USER_AGENT", "AgriSightAI/2.0 (college project; contact: set PROVIDER_USER_AGENT)"),
    googlePlacesApiKey: env("GOOGLE_PLACES_API_KEY", ""),
    helpCentersDir: resolvePath(env("HELP_CENTERS_DIR", "data/help_centers")),
  },

  weather: {
    provider: env("WEATHER_PROVIDER", "open-meteo"),
    openMeteoUrl: env("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast"),
    cacheTtlSeconds: int("WEATHER_CACHE_TTL_SECONDS", 3 * 3600),
    timeoutMs: int("WEATHER_TIMEOUT_MS", 15000),
    riskRulesDir: resolvePath(env("RISK_RULES_DIR", "knowledge_base/risk_rules")),
  },
};

export function resolveProjectPath(p) {
  return resolvePath(p);
}
