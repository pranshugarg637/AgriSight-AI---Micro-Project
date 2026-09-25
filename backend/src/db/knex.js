import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import knexFactory from "knex";
import { config, resolveProjectPath } from "../config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/**
 * Builds a Knex instance. SQLite (better-sqlite3) in dev/tests, Postgres
 * (pg) in Compose/production -- same migrations for both.
 */
export function createDb(overrides = {}) {
  const dbConfig = { ...config.db, ...overrides };
  const client = dbConfig.client;

  if (client === "pg" || client === "postgres" || client === "postgresql") {
    if (!dbConfig.url) throw new Error("[db] DATABASE_URL must be set when DB_CLIENT=pg");
    return knexFactory({
      client: "pg",
      connection: dbConfig.url,
      searchPath: dbConfig.searchPath ? [dbConfig.searchPath] : undefined,
      pool: { min: 0, max: 10 },
    });
  }

  let filename = dbConfig.filename;
  if (filename !== ":memory:") {
    filename = resolveProjectPath(filename);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  return knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    // one connection: required for :memory: and avoids SQLITE_BUSY in dev
    pool: {
      min: 1,
      max: 1,
      afterCreate: (conn, done) => {
        conn.pragma("foreign_keys = ON");
        done();
      },
    },
  });
}

let singleton = null;
export function getDb() {
  if (!singleton) singleton = createDb();
  return singleton;
}

export async function migrateLatest(db = getDb()) {
  return db.migrate.latest({ directory: MIGRATIONS_DIR, loadExtensions: [".js"] });
}

export async function closeDb() {
  if (singleton) {
    await singleton.destroy();
    singleton = null;
  }
}

/** JSON columns are TEXT for portability; (de)serialise here. */
export const json = {
  dump: (v) => (v === undefined || v === null ? null : JSON.stringify(v)),
  load: (v, fallback = null) => {
    if (v === null || v === undefined || v === "") return fallback;
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  },
};

export const nowIso = () => new Date().toISOString();
