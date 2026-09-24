import "./setup-env.js";
// Tight limits for this file only (config is read at import time).
process.env.AUTH_RATE_LIMIT_MAX = "3";
process.env.FARMER_PREDICT_RATE_LIMIT_PER_MIN = "2";

const { test, before, after } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const request = (await import("supertest")).default;
const { makeDb, startMockMl, HIGH_RESULT, FAKE_JPEG } = await import("./helpers.js");
const { createApp } = await import("../src/app.js");

let db, app, ml;
before(async () => {
  ml = await startMockMl({ "POST /api/predict": () => [200, HIGH_RESULT] });
  process.env.ML_SERVICE_URL = `http://localhost:${ml.port}`;
  db = await makeDb();
  app = createApp({ db });
});
after(async () => {
  ml.server.close();
  await db.destroy();
});

test("auth routes are rate limited per IP", async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await request(app).post("/api/auth/login").send({ email: "x@example.com", password: "whatever-pass" });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0, 3), [401, 401, 401]);
  assert.equal(statuses[3], 429);
  assert.equal(statuses[4], 429);
});

test("guest farmer predict has its own tighter per-IP limit", async () => {
  const statuses = [];
  for (let i = 0; i < 3; i++) {
    const r = await request(app).post("/api/farmer/predict").attach("file", FAKE_JPEG, { filename: "l.jpg", contentType: "image/jpeg" });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});
