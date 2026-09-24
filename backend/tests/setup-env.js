// Imported FIRST by every test file: config is read at import time.
import os from "os";
import path from "path";
import fs from "fs";

process.env.NODE_ENV = "test";
process.env.ENV = "test";
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = ":memory:";
process.env.JWT_SECRET = "test-jwt-secret-that-is-long-enough-0123456789";
process.env.BCRYPT_COST = "4";
process.env.ML_INTERNAL_TOKEN = "test-internal-token";
process.env.COOKIE_SECURE = "false";
process.env.IMAGE_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agrisight-img-"));
process.env.AUTH_RATE_LIMIT_MAX = "1000";
