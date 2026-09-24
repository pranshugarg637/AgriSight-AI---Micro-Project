import http from "node:http";
import request from "supertest";
import { createDb, migrateLatest } from "../src/db/knex.js";
import { hashPassword } from "../src/auth/passwords.js";
import { createUser } from "../src/repositories/users.js";

export const TEST_PASSWORD = "correct-horse-battery";
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

export async function makeDb() {
  const db = createDb({ client: "better-sqlite3", filename: ":memory:" });
  await migrateLatest(db);
  return db;
}

export async function makeUser(db, { email = "user@example.com", role = "user", password = TEST_PASSWORD } = {}) {
  return createUser(db, { email, passwordHash: await hashPassword(password, 4), role });
}

export async function login(app, email, password = TEST_PASSWORD) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.access_token, cookie: res.headers["set-cookie"], body: res.body };
}

/**
 * Tiny fake ML service. `handlers` maps "METHOD /path" -> (req, body) => [status, json].
 * Records every request (with headers) in `calls`.
 */
export function startMockMl(handlers = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const key = `${req.method} ${req.url.split("?")[0]}`;
      const h = handlers[key];
      res.setHeader("Content-Type", "application/json");
      if (req.headers["x-internal-token"] !== process.env.ML_INTERNAL_TOKEN) {
        res.writeHead(401);
        return res.end(JSON.stringify({ detail: "missing internal token" }));
      }
      if (!h) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: "not_found" }));
      }
      const out = h(req, body);
      if (out && out.raw) return out.raw(res);
      const [status, json] = out;
      res.writeHead(status);
      res.end(JSON.stringify(json));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, port: server.address().port, calls, handlers }));
  });
}

export const HIGH_RESULT = {
  diagnosis: "Late blight",
  crop: "Tomato",
  class_key: "Tomato___Late_blight",
  confidence: 0.91,
  confidence_level: "high",
  is_reliable: true,
  confidence_message: "High-confidence prediction.",
  alternatives: [],
  retrieval_status: "success",
  sources: [],
  model_version: "1.0.0",
};
