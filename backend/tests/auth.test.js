import "./setup-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import { makeDb, makeUser, login, TEST_PASSWORD, startMockMl, HIGH_RESULT, FAKE_JPEG } from "./helpers.js";
import { createApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/auth/passwords.js";
import { signAccessToken, verifyAccessToken } from "../src/auth/tokens.js";
import { requireAuth, requireRole } from "../src/middleware/auth.js";

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

const cookieValue = (setCookie) => (setCookie || []).find((c) => c.startsWith("agrisight_rt="))?.split(";")[0];

test("passwords are hashed with bcrypt, never stored in plain text", async () => {
  const hash = await hashPassword("a-long-password-1", 4);
  assert.notEqual(hash, "a-long-password-1");
  assert.match(hash, /^\$2[aby]\$04\$/);
  assert.equal(await verifyPassword("a-long-password-1", hash), true);
  assert.equal(await verifyPassword("wrong-password-xx", hash), false);
  await assert.rejects(() => hashPassword("short", 4));

  await request(app).post("/api/auth/register").send({ email: "hash@example.com", password: "a-long-password-1" });
  const row = await db("users").where({ email: "hash@example.com" }).first();
  assert.ok(row.password_hash.startsWith("$2"));
  assert.ok(!JSON.stringify(row).includes("a-long-password-1"));
});

test("register never reveals whether an email already exists", async () => {
  const first = await request(app).post("/api/auth/register").send({ email: "dup@example.com", password: TEST_PASSWORD });
  const second = await request(app).post("/api/auth/register").send({ email: "DUP@example.com", password: "another-password-2" });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.deepEqual(first.body, second.body);
  // the second registration must not have changed the original password
  const { body } = await login(app, "dup@example.com", TEST_PASSWORD);
  assert.equal(body.user.email, "dup@example.com");
  assert.equal(body.user.role, "user");
});

test("register validates input and never grants roles from the request", async () => {
  const bad = await request(app).post("/api/auth/register").send({ email: "not-an-email", password: "x" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "validation_error");
  await request(app).post("/api/auth/register").send({ email: "sneaky@example.com", password: TEST_PASSWORD, role: "admin" });
  const row = await db("users").where({ email: "sneaky@example.com" }).first();
  assert.equal(row.role, "user");
});

test("login errors are generic for unknown email and wrong password", async () => {
  await makeUser(db, { email: "known@example.com" });
  const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: TEST_PASSWORD });
  const wrong = await request(app).post("/api/auth/login").send({ email: "known@example.com", password: "wrong-password" });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
});

test("account locks after repeated failures (same generic error), and a correct password is refused while locked", async () => {
  await makeUser(db, { email: "lock@example.com" });
  for (let i = 0; i < 5; i++) {
    await request(app).post("/api/auth/login").send({ email: "lock@example.com", password: "bad-password" });
  }
  const row = await db("users").where({ email: "lock@example.com" }).first();
  assert.ok(row.locked_until, "locked_until should be set");
  const res = await request(app).post("/api/auth/login").send({ email: "lock@example.com", password: TEST_PASSWORD });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "invalid_credentials");
  // unlock (simulate lockout expiry) -> works again
  await db("users").where({ id: row.id }).update({ locked_until: new Date(Date.now() - 1000).toISOString() });
  const ok = await request(app).post("/api/auth/login").send({ email: "lock@example.com", password: TEST_PASSWORD });
  assert.equal(ok.status, 200);
});

test("login returns a short-lived access token and an httpOnly SameSite refresh cookie", async () => {
  await makeUser(db, { email: "cookie@example.com" });
  const res = await request(app).post("/api/auth/login").send({ email: "cookie@example.com", password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.token_type, "Bearer");
  assert.equal(res.body.expires_in, 900);
  const cookie = res.headers["set-cookie"].find((c) => c.startsWith("agrisight_rt="));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/auth/);
  const stored = await db("refresh_tokens").select("token_hash");
  const raw = cookieValue(res.headers["set-cookie"]).split("=")[1];
  assert.ok(stored.every((r) => r.token_hash !== raw), "refresh tokens are stored hashed");
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.access_token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "cookie@example.com");
  assert.equal(me.body.user.password_hash, undefined);
});

test("expired and tampered access tokens are rejected", async () => {
  const user = await makeUser(db, { email: "exp@example.com" });
  const expired = signAccessToken(user, { ttlSeconds: -10 });
  const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${expired}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "token_expired");

  const good = signAccessToken(user);
  const [h, p, s] = good.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), role: "admin" })).toString("base64url");
  assert.throws(() => verifyAccessToken(`${h}.${forgedPayload}.${s}`));
  const res2 = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${h}.${forgedPayload}.${s}`);
  assert.equal(res2.status, 401);
});

test("refresh rotates the token; reusing an old refresh token revokes the whole family", async () => {
  await makeUser(db, { email: "rotate@example.com" });
  const first = await request(app).post("/api/auth/login").send({ email: "rotate@example.com", password: TEST_PASSWORD });
  const c1 = cookieValue(first.headers["set-cookie"]);

  const r1 = await request(app).post("/api/auth/refresh").set("Cookie", c1);
  assert.equal(r1.status, 200);
  assert.ok(r1.body.access_token);
  const c2 = cookieValue(r1.headers["set-cookie"]);
  assert.notEqual(c1, c2);

  // reuse of the rotated (old) token -> rejected, family revoked
  const reuse = await request(app).post("/api/auth/refresh").set("Cookie", c1);
  assert.equal(reuse.status, 401);
  // ...so even the newest token no longer works
  const after = await request(app).post("/api/auth/refresh").set("Cookie", c2);
  assert.equal(after.status, 401);
});

test("expired refresh token is rejected", async () => {
  await makeUser(db, { email: "rexp@example.com" });
  const res = await request(app).post("/api/auth/login").send({ email: "rexp@example.com", password: TEST_PASSWORD });
  await db("refresh_tokens").update({ expires_at: new Date(Date.now() - 1000).toISOString() });
  const r = await request(app).post("/api/auth/refresh").set("Cookie", cookieValue(res.headers["set-cookie"]));
  assert.equal(r.status, 401);
});

test("logout revokes the refresh token", async () => {
  await makeUser(db, { email: "logout@example.com" });
  const res = await request(app).post("/api/auth/login").send({ email: "logout@example.com", password: TEST_PASSWORD });
  const c = cookieValue(res.headers["set-cookie"]);
  const out = await request(app).post("/api/auth/logout").set("Cookie", c);
  assert.equal(out.status, 204);
  const r = await request(app).post("/api/auth/refresh").set("Cookie", c);
  assert.equal(r.status, 401);
});

test("requireRole guards: user forbidden, expert/admin allowed", async () => {
  const mini = express();
  mini.get("/expert", requireAuth, requireRole("expert", "admin"), (req, res) => res.json({ ok: true }));
  const user = await makeUser(db, { email: "r-user@example.com", role: "user" });
  const expert = await makeUser(db, { email: "r-expert@example.com", role: "expert" });
  const admin = await makeUser(db, { email: "r-admin@example.com", role: "admin" });
  assert.equal((await request(mini).get("/expert")).status, 401);
  assert.equal((await request(mini).get("/expert").set("Authorization", `Bearer ${signAccessToken(user)}`)).status, 403);
  assert.equal((await request(mini).get("/expert").set("Authorization", `Bearer ${signAccessToken(expert)}`)).status, 200);
  assert.equal((await request(mini).get("/expert").set("Authorization", `Bearer ${signAccessToken(admin)}`)).status, 200);
});

test("account predict rejects requests without a token", async () => {
  const res = await request(app).post("/api/predict").attach("file", FAKE_JPEG, { filename: "l.jpg", contentType: "image/jpeg" });
  assert.equal(res.status, 401);
});

test("guest farmer predict works without a token, sends the internal token to ML, and stores no image or user", async () => {
  const res = await request(app)
    .post("/api/farmer/predict")
    .field("language", "hi")
    .attach("file", FAKE_JPEG, { filename: "leaf.jpg", contentType: "image/jpeg" });
  assert.equal(res.status, 200);
  assert.equal(res.body.diagnosis, "Late blight");
  const call = ml.calls.at(-1);
  assert.equal(call.headers["x-internal-token"], "test-internal-token");
  const scan = await db("scans").orderBy("id", "desc").first();
  assert.equal(scan.mode, "farmer");
  assert.equal(scan.user_id, null);
  assert.equal(scan.image_ref, null);
  assert.equal(scan.language, "hi");
});

test("farmer upload rejects files whose bytes are not an image (magic-byte check)", async () => {
  const res = await request(app)
    .post("/api/farmer/predict")
    .attach("file", Buffer.from("GIF89a-not-really-jpeg"), { filename: "x.jpg", contentType: "image/jpeg" });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "invalid_file_type");
});

test("authenticated predict saves the scan to the user's default plot", async () => {
  await makeUser(db, { email: "scan@example.com" });
  const { token } = await login(app, "scan@example.com");
  const res = await request(app)
    .post("/api/predict")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", FAKE_JPEG, { filename: "leaf.jpg", contentType: "image/jpeg" });
  assert.equal(res.status, 200);
  assert.ok(res.body.scan_id);
  const scan = await db("scans").where({ id: res.body.scan_id }).first();
  assert.equal(scan.mode, "account");
  const plot = await db("plots").where({ id: scan.plot_id }).first();
  assert.equal(plot.name, "My field");
});

test("DELETE /api/auth/me really deletes the account and its scans", async () => {
  await makeUser(db, { email: "del@example.com" });
  const { token } = await login(app, "del@example.com");
  await request(app)
    .post("/api/predict")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", FAKE_JPEG, { filename: "leaf.jpg", contentType: "image/jpeg" });
  const user = await db("users").where({ email: "del@example.com" }).first();
  const res = await request(app).delete("/api/auth/me").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 204);
  assert.equal(await db("users").where({ id: user.id }).first(), undefined);
  assert.equal((await db("scans").where({ user_id: user.id })).length, 0);
  assert.equal((await db("refresh_tokens").where({ user_id: user.id })).length, 0);
});
