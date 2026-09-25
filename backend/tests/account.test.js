import "./setup-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { makeDb, makeUser, login, startMockMl, HIGH_RESULT } from "./helpers.js";
import { createApp } from "../src/app.js";
import { compareScans } from "../src/services/followup.js";
import { loadRules, evaluateRule, validateRule, assessRisk, rulesForCrop } from "../src/services/riskEngine.js";
import { WeatherService } from "../src/services/weather.js";

// A real (tiny) JPEG so the image store can strip metadata and save it.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

let db, app, ml, mlResult;
const hourly = (temp, rain, hours = 48) =>
  Array.from({ length: hours }, (_, i) => ({
    time: `2026-10-0${1 + Math.floor(i / 24)}T${String(i % 24).padStart(2, "0")}:00`,
    temperature_c: temp,
    relative_humidity: 90,
    precipitation_mm: rain,
  }));
let fakeWeather = { available: true, source: "fake", hourly: hourly(20, 1.2) };

before(async () => {
  mlResult = { ...HIGH_RESULT, gradcam_image_base64: null };
  ml = await startMockMl({ "POST /api/predict": () => [200, mlResult] });
  process.env.ML_SERVICE_URL = `http://localhost:${ml.port}`;
  db = await makeDb();
  app = createApp({
    db,
    account: {
      weather: { forecast: async () => fakeWeather },
      loadRules: () => loadRules(path.resolve(import.meta.dirname, "../../knowledge_base/risk_rules"), { production: false }).rules,
    },
  });
});
after(async () => {
  ml.server.close();
  await db.destroy();
});

async function userSession(email, role = "user") {
  await makeUser(db, { email, role });
  const { token } = await login(app, email);
  return (r) => r.set("Authorization", `Bearer ${token}`);
}

async function scan(auth, fields = {}) {
  let r = request(app).post("/api/predict");
  r = auth(r);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
  const res = await r.attach("file", JPEG, { filename: "leaf.jpg", contentType: "image/jpeg" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test("plots CRUD; coordinates are dropped unless the user opted in", async () => {
  const auth = await userSession("plots@example.com");
  const c = await auth(request(app).post("/api/v2/plots")).send({ name: "North field", crop: "Tomato", lat: 26.8, lng: 80.9 });
  assert.equal(c.status, 201);
  assert.equal(c.body.plot.lat, null);
  await auth(request(app).patch("/api/auth/me")).send({ store_location_opt_in: true });
  const c2 = await auth(request(app).post("/api/v2/plots")).send({ name: "South", crop: "Tomato", lat: 26.8, lng: 80.9 });
  assert.equal(c2.body.plot.lat, 26.8);
  await auth(request(app).patch("/api/auth/me")).send({ store_location_opt_in: false });
  const row = await db("plots").where({ id: c2.body.plot.id }).first();
  assert.equal(row.lat, null, "opting out erases stored coordinates");
  const list = await auth(request(app).get("/api/v2/plots"));
  assert.equal(list.body.plots.length, 2);
});

test("ownership: a user cannot read, delete or act on another user's scans or plots", async () => {
  const alice = await userSession("alice@example.com");
  const bob = await userSession("bob@example.com");
  const s = await scan(alice);
  for (const req of [
    bob(request(app).get(`/api/v2/scans/${s.scan_id}`)),
    bob(request(app).get(`/api/v2/scans/${s.scan_id}/image`)),
    bob(request(app).delete(`/api/v2/scans/${s.scan_id}`)),
    bob(request(app).post(`/api/v2/scans/${s.scan_id}/actions`)).send({ action_type: "sprayed" }),
    bob(request(app).get(`/api/v2/plots/${s.plot_id}/timeline`)),
    bob(request(app).delete(`/api/v2/plots/${s.plot_id}`)),
  ]) {
    assert.equal((await req).status, 404);
  }
  assert.equal((await alice(request(app).get(`/api/v2/scans/${s.scan_id}`))).status, 200);
  // bob cannot attach a scan to alice's plot or follow up alice's scan
  const bad = await bob(request(app).post("/api/predict")).field("plot_id", String(s.plot_id)).attach("file", JPEG, { filename: "l.jpg", contentType: "image/jpeg" });
  assert.equal(bad.status, 404);
});

test("account routes reject missing tokens", async () => {
  assert.equal((await request(app).get("/api/v2/plots")).status, 401);
  assert.equal((await request(app).get("/api/v2/expert/queue")).status, 401);
});

test("scan image is stored EXIF-free, served to the owner, and really deleted with the scan", async () => {
  const auth = await userSession("img@example.com");
  const s = await scan(auth);
  const row = await db("scans").where({ id: s.scan_id }).first();
  const file = path.join(process.env.IMAGE_STORE_DIR, row.image_ref);
  assert.ok(fs.existsSync(file));
  const img = await auth(request(app).get(`/api/v2/scans/${s.scan_id}/image`));
  assert.equal(img.status, 200);
  const del = await auth(request(app).delete(`/api/v2/scans/${s.scan_id}`));
  assert.equal(del.status, 204);
  assert.equal(fs.existsSync(file), false);
  assert.equal(await db("scans").where({ id: s.scan_id }).first(), undefined);
});

test("actions create a re-scan reminder; a follow-up scan records an indicative outcome and clears the reminder", async () => {
  const auth = await userSession("follow@example.com");
  mlResult = { ...HIGH_RESULT, confidence: 0.95 };
  const first = await scan(auth);
  const a = await auth(request(app).post(`/api/v2/scans/${first.scan_id}/actions`)).send({ action_type: "removed_leaves", remind_in_days: 1 });
  assert.equal(a.status, 201);
  await db("actions").where({ id: a.body.action.id }).update({ remind_at: new Date(Date.now() - 1000).toISOString() });
  let rem = await auth(request(app).get("/api/v2/reminders"));
  assert.equal(rem.body.reminders.length, 1);

  mlResult = { ...HIGH_RESULT, class_key: "Tomato___healthy", diagnosis: "healthy", confidence: 0.9 };
  const second = await scan(auth, { plot_id: first.plot_id, followup_of: first.scan_id });
  assert.equal(second.followup.outcome, "improved");
  assert.match(second.followup.basis.note, /Indicative/);
  rem = await auth(request(app).get("/api/v2/reminders"));
  assert.equal(rem.body.reminders.length, 0);

  const tl = await auth(request(app).get(`/api/v2/plots/${first.plot_id}/timeline`));
  assert.equal(tl.body.timeline.length, 2);
  assert.equal(tl.body.timeline[0].followup.outcome, "improved");
  assert.equal(tl.body.timeline[1].actions[0].action_type, "removed_leaves");
  assert.equal(tl.body.timeline[0].image_ref, undefined);
  mlResult = { ...HIGH_RESULT };
});

test("follow-up comparison logic", () => {
  const s = (class_key, confidence, confidence_level = "high") => ({ class_key, confidence, confidence_level });
  assert.equal(compareScans(s("T___Late_blight", 0.9), s("T___healthy", 0.9)).outcome, "improved");
  assert.equal(compareScans(s("T___healthy", 0.9), s("T___Late_blight", 0.9)).outcome, "worse");
  assert.equal(compareScans(s("T___Late_blight", 0.95), s("T___Late_blight", 0.7, "low")).outcome, "improved");
  assert.equal(compareScans(s("T___Late_blight", 0.7, "low"), s("T___Late_blight", 0.95)).outcome, "worse");
  assert.equal(compareScans(s("T___Late_blight", 0.9), s("T___Late_blight", 0.85)).outcome, "same");
  assert.equal(compareScans(s("T___Late_blight", 0.9), s("T___Early_blight", 0.9)).outcome, "inconclusive");
  assert.equal(compareScans(s("T___Late_blight", 0.9), s("T___healthy", 0.3, "unreliable")).outcome, "inconclusive");
});

test("risk engine: refuses uncited rules, placeholder rules in production; counts matching hours per day", () => {
  assert.ok(validateRule({ id: "x", class_key: "A___b", conditions: { temperature_c: { min: 1 } } }).some((e) => e.includes("citation")));
  const dir = path.resolve(import.meta.dirname, "../../knowledge_base/risk_rules");
  assert.equal(loadRules(dir, { production: false }).rules.length, 2);
  const prod = loadRules(dir, { production: true });
  assert.equal(prod.rules.length, 0);
  assert.equal(prod.rejected.length, 2);

  const rule = loadRules(dir, { production: false }).rules.find((r) => r.class_key === "Tomato___Late_blight");
  const wet = evaluateRule(rule, hourly(20, 0.5));
  assert.equal(wet.days.length, 2);
  assert.ok(wet.days.every((d) => d.level === "favourable_conditions_forecast" && d.matching_hours === 24));
  assert.equal(wet.citation.file, "tomato_late_blight_guide.pdf");
  const dry = evaluateRule(rule, hourly(20, 0));
  assert.ok(dry.days.every((d) => d.level === "no_matching_conditions"));
  const hot = evaluateRule(rule, hourly(35, 3));
  assert.equal(hot.any_favourable, false);
  assert.equal(rulesForCrop([rule], "Potato").length, 0);
  assert.equal(assessRisk([rule], { available: false }).results.length, 0);
});

test("GET /api/v2/risk uses the plot crop's rules with mocked weather and labels it an indicator", async () => {
  const auth = await userSession("risk@example.com");
  const p = await auth(request(app).post("/api/v2/plots")).send({ name: "Tomatoes", crop: "Tomato" });
  const noLoc = await auth(request(app).get(`/api/v2/risk?plot_id=${p.body.plot.id}`));
  assert.equal(noLoc.status, 422);
  const res = await auth(request(app).get(`/api/v2/risk?plot_id=${p.body.plot.id}&lat=26.8&lng=80.9`));
  assert.equal(res.status, 200);
  assert.equal(res.body.label, "risk indicator");
  assert.match(res.body.disclaimer, /not a prediction/);
  assert.equal(res.body.rules_available, 2);
  assert.ok(res.body.results.find((r) => r.class_key === "Tomato___Late_blight").any_favourable);
  const row = await db("plots").where({ id: p.body.plot.id }).first();
  assert.equal(row.lat, null, "query coordinates are not stored");
  fakeWeather = { available: false, reason: "weather_unavailable", hourly: [] };
  const down = await auth(request(app).get(`/api/v2/risk?plot_id=${p.body.plot.id}&lat=26.8&lng=80.9`));
  assert.equal(down.status, 200);
  assert.equal(down.body.weather_available, false);
  fakeWeather = { available: true, source: "fake", hourly: hourly(20, 1.2) };
});

test("weather service caches and survives provider outages", async () => {
  let calls = 0;
  const svc = new WeatherService({ name: "p", forecast: async () => (calls++, { available: true, hourly: [] }) }, 60);
  await svc.forecast(26.81, 80.91);
  const again = await svc.forecast(26.812, 80.913);
  assert.equal(calls, 1);
  assert.equal(again.cached, true);
  const broken = new WeatherService({ name: "p", forecast: async () => { throw new Error("down"); } }, 60);
  assert.equal((await broken.forecast(1, 2)).available, false);
});

test("expert review: role gating, queue contents, confirm/correct writes reviewed_labels", async () => {
  const user = await userSession("farmer@example.com");
  const expert = await userSession("expert@example.com", "expert");
  mlResult = { ...HIGH_RESULT, confidence: 0.7, confidence_level: "low", alternatives: [{ crop: "Tomato", disease: "Early blight", confidence: 0.25 }] };
  const low = await scan(user);
  mlResult = { ...HIGH_RESULT };
  const high = await scan(user);
  await user(request(app).post(`/api/v2/scans/${high.scan_id}/dispute`));

  assert.equal((await user(request(app).get("/api/v2/expert/queue"))).status, 403);
  const q = await expert(request(app).get("/api/v2/expert/queue"));
  assert.equal(q.status, 200);
  const ids = q.body.queue.map((s) => s.id);
  assert.ok(ids.includes(low.scan_id) && ids.includes(high.scan_id));
  assert.equal(q.body.queue[0].user_id, undefined, "experts do not see who the farmer is");
  assert.ok(q.body.queue.find((s) => s.id === low.scan_id).alternatives.length > 0);

  const bad = await expert(request(app).post(`/api/v2/expert/scans/${low.scan_id}/review`)).send({ decision: "correct" });
  assert.equal(bad.status, 400);
  const r1 = await expert(request(app).post(`/api/v2/expert/scans/${low.scan_id}/review`)).send({ decision: "correct", corrected_class_key: "Tomato___Early_blight", note: "rings visible" });
  assert.equal(r1.status, 201);
  const r2 = await expert(request(app).post(`/api/v2/expert/scans/${high.scan_id}/review`)).send({ decision: "confirm" });
  assert.equal(r2.body.label, "Tomato___Late_blight");
  const labels = await db("reviewed_labels").orderBy("scan_id");
  assert.deepEqual(labels.map((l) => [l.class_key, l.model_class_key]), [
    ["Tomato___Early_blight", "Tomato___Late_blight"],
    ["Tomato___Late_blight", "Tomato___Late_blight"],
  ]);
  const q2 = await expert(request(app).get("/api/v2/expert/queue"));
  assert.ok(!q2.body.queue.some((s) => s.id === low.scan_id), "reviewed scans leave the queue");
  const tl = await user(request(app).get(`/api/v2/plots/${low.plot_id}/timeline`));
  assert.equal(tl.body.timeline.find((s) => s.id === low.scan_id).expert_label, "Tomato___Early_blight");
});
