import "./setup-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeDb, makeUser, login, startMockMl, HIGH_RESULT, FAKE_JPEG } from "./helpers.js";
import { createApp } from "../src/app.js";
import { parseSseBlock } from "../src/services/sseRelay.js";
import { computeMetrics } from "../src/services/metrics.js";
import { nowIso } from "../src/db/knex.js";

let db, app, ml;
const sse = (events) => ({
  raw: (res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [e, d] of events) res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    res.end();
  },
});

before(async () => {
  ml = await startMockMl({
    "POST /api/predict/stream": () =>
      sse([
        ["stage", { stage: "validate", status: "start" }],
        ["stage", { stage: "validate", status: "done" }],
        ["stage", { stage: "classify", status: "done", confidence_level: "high" }],
        ["result", HIGH_RESULT],
      ]),
  });
  process.env.ML_SERVICE_URL = `http://localhost:${ml.port}`;
  db = await makeDb();
  app = createApp({ db });
});
after(async () => {
  ml.server.close();
  await db.destroy();
});

function parse(text) {
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map(parseSseBlock)
    .map((e) => ({ event: e.event, data: JSON.parse(e.data) }));
}

test("farmer stream relays real stage events and records the scan on the result event", async () => {
  const res = await request(app)
    .post("/api/farmer/predict/stream")
    .attach("file", FAKE_JPEG, { filename: "l.jpg", contentType: "image/jpeg" })
    .buffer(true)
    .parse((r, cb) => {
      let t = "";
      r.on("data", (c) => (t += c));
      r.on("end", () => cb(null, t));
    });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/event-stream/);
  const events = parse(res.body);
  assert.deepEqual(events.map((e) => e.event), ["stage", "stage", "stage", "result"]);
  assert.equal(events[2].data.stage, "classify");
  assert.equal(events.at(-1).data.diagnosis, "Late blight");
  assert.equal((await db("scans").where({ mode: "farmer" })).length, 1);
});

test("account stream requires auth and adds scan_id to the result", async () => {
  assert.equal((await request(app).post("/api/predict/stream")).status, 401);
  await makeUser(db, { email: "stream@example.com" });
  const { token } = await login(app, "stream@example.com");
  const res = await request(app)
    .post("/api/predict/stream")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", FAKE_JPEG, { filename: "l.jpg", contentType: "image/jpeg" })
    .buffer(true)
    .parse((r, cb) => {
      let t = "";
      r.on("data", (c) => (t += c));
      r.on("end", () => cb(null, t));
    });
  const result = parse(res.body).at(-1);
  assert.equal(result.event, "result");
  assert.ok(result.data.scan_id);
});

test("metrics aggregation", () => {
  const t = "2026-09-20T10:00:00.000Z";
  const scans = [
    { mode: "farmer", class_key: "T___Late_blight", confidence: 0.95, confidence_level: "high", retrieval_status: "success", created_at: t },
    { mode: "account", class_key: "T___Late_blight", confidence: 0.65, confidence_level: "low", retrieval_status: "success", created_at: t },
    { mode: "farmer", class_key: "T___healthy", confidence: 0.3, confidence_level: "unreliable", unreliable_reason: "not_a_leaf", retrieval_status: "skipped_low_confidence", created_at: t },
  ];
  const m = computeMetrics(scans, [
    { class_key: "T___Late_blight", model_class_key: "T___Late_blight" },
    { class_key: "T___Early_blight", model_class_key: "T___Late_blight" },
  ]);
  assert.equal(m.total_scans, 3);
  assert.deepEqual(m.scans_per_day, [{ date: "2026-09-20", farmer: 2, account: 1 }]);
  assert.ok(Math.abs(m.share_low_or_unreliable - 2 / 3) < 1e-9);
  assert.equal(m.ood_rejections, 1);
  assert.equal(m.retrieval_status.success, 2);
  const lb = m.per_class.find((c) => c.class_key === "T___Late_blight");
  assert.equal(lb.n, 2);
  assert.ok(Math.abs(lb.mean_confidence - 0.8) < 1e-9);
  assert.equal(lb.histogram[9], 1);
  assert.equal(lb.weekly.length, 1);
  assert.equal(m.expert_labels.accuracy, 0.5);
});

test("admin metrics endpoint is admin-only and has no personal data", async () => {
  await makeUser(db, { email: "plain@example.com" });
  await makeUser(db, { email: "boss@example.com", role: "admin" });
  const u = await login(app, "plain@example.com");
  const a = await login(app, "boss@example.com");
  assert.equal((await request(app).get("/api/v2/admin/metrics").set("Authorization", `Bearer ${u.token}`)).status, 403);
  const res = await request(app).get("/api/v2/admin/metrics?days=7").set("Authorization", `Bearer ${a.token}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.total_scans >= 1);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes("@example.com") && !text.includes("user_id"));
});

test("secrets and passwords never reach the logs", async () => {
  const captured = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => captured.push(a.map(String).join(" "));
  try {
    await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "SuperSecretPassw0rd!" });
    await request(app).post("/api/auth/register").send({ email: "bad", password: "SuperSecretPassw0rd!" });
    await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"email": "x", "password": "SuperSecretPassw0rd!"'); // malformed JSON
  } finally {
    Object.assign(console, orig);
  }
  const all = captured.join("\n");
  assert.ok(!all.includes("SuperSecretPassw0rd!"));
  assert.ok(!all.includes(process.env.JWT_SECRET));
  assert.ok(!all.includes(process.env.ML_INTERNAL_TOKEN));
});

test("security headers are set (helmet) and CORS only allows configured origins", async () => {
  const res = await request(app).get("/").set("Origin", "https://evil.example");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.ok(res.headers["content-security-policy"]);
  assert.equal(res.headers["x-powered-by"], undefined);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  const ok = await request(app).get("/").set("Origin", "http://localhost:5173");
  assert.equal(ok.headers["access-control-allow-origin"], "http://localhost:5173");
});

test("upload size caps: farmer uploads above FARMER_MAX_IMAGE_SIZE_MB are rejected", async () => {
  const big = Buffer.concat([FAKE_JPEG, Buffer.alloc(5 * 1024 * 1024)]);
  const res = await request(app).post("/api/farmer/predict").attach("file", big, { filename: "big.jpg", contentType: "image/jpeg" });
  assert.equal(res.status, 413);
});

void nowIso;
