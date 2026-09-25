import "./setup-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { makeDb } from "./helpers.js";
import { createApp } from "../src/app.js";
import { ShopFinder } from "../src/services/shops/index.js";
import { OverpassShopProvider } from "../src/services/shops/overpass.js";
import { HelpCenterDirectory, validateCenter } from "../src/services/helpCenters.js";
import { requestLogger } from "../src/middleware/requestLogger.js";

const LAT = 26.8467123;
const LNG = 80.9461987;

function fakeProvider(shops = [], { fail = false } = {}) {
  const calls = [];
  return {
    name: "fake",
    attribution: "© test",
    calls,
    async search(args) {
      calls.push(args);
      if (fail) throw Object.assign(new Error("boom"), { code: "PROVIDER_ERROR" });
      return shops;
    },
  };
}

function tmpCenters(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hc-"));
  for (const [name, doc] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(doc));
  return dir;
}

const OFFICE = {
  name: "Test KVK",
  type: "kvk",
  district: "Lucknow",
  phone: "0000",
  lat: 26.85,
  lng: 80.95,
  source_url: "https://example.gov/kvk-list",
  verified_on: "2026-09-01",
};

let db;
before(async () => {
  db = await makeDb();
});
after(async () => db.destroy());

function appWith({ provider, centers = {}, logStream } = {}) {
  const deps = {
    shopFinder: new ShopFinder(provider || fakeProvider(), { ttlSeconds: 60, radiusM: 10000, limit: 5 }),
    helpDirectory: new HelpCenterDirectory(tmpCenters(centers)),
    geocoder: { attribution: "x", search: async (q) => [{ name: q, lat: 1, lng: 2 }] },
  };
  return createApp({
    db,
    farmer: deps,
    requestLogger: logStream ? requestLogger({ stream: logStream, skip: () => false }) : undefined,
  });
}

test("shops: provider results + nearest offices + stock disclaimer; coordinates rounded before leaving the server", async () => {
  const provider = fakeProvider([{ id: "osm:node/1", name: "Kisan Seva Kendra", distance_m: 800, lat: 26.85, lng: 80.94 }]);
  const app = appWith({ provider, centers: { "up.json": { state: "UP", centers: [OFFICE] } } });
  const res = await request(app).get(`/api/farmer/shops?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.shops.length, 1);
  assert.equal(res.body.office_fallback, false);
  assert.match(res.body.stock_disclaimer, /does not guarantee/);
  assert.equal(res.body.offices[0].name, "Test KVK");
  assert.deepEqual(provider.calls[0], { lat: 26.847, lng: 80.946, radiusM: 10000, limit: 5 });
  assert.equal(res.headers["cache-control"], "no-store");
});

test("shops are cached per rounded point (provider hit once)", async () => {
  const provider = fakeProvider([]);
  const app = appWith({ provider });
  await request(app).get(`/api/farmer/shops?lat=${LAT}&lng=${LNG}`);
  const again = await request(app).get(`/api/farmer/shops?lat=${LAT + 0.0001}&lng=${LNG}`);
  assert.equal(provider.calls.length, 1);
  assert.equal(again.body.cached, true);
});

test("no shops -> office fallback flag", async () => {
  const app = appWith({ provider: fakeProvider([]), centers: { "up.json": { state: "UP", centers: [OFFICE] } } });
  const res = await request(app).get(`/api/farmer/shops?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.body.office_fallback, true);
  assert.equal(res.body.offices.length, 1);
});

test("provider outage -> empty list with provider_error, still 200", async () => {
  const app = appWith({ provider: fakeProvider([], { fail: true }) });
  const res = await request(app).get(`/api/farmer/shops?lat=${LAT}&lng=${LNG}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.provider_error, true);
  assert.equal(res.body.office_fallback, true);
});

test("invalid coordinates are rejected", async () => {
  const app = appWith();
  assert.equal((await request(app).get("/api/farmer/shops?lat=200&lng=1")).status, 400);
  assert.equal((await request(app).get("/api/farmer/shops")).status, 400);
});

test("curated help centres: entries without an official source are rejected; district lookup + index", async () => {
  const dir = tmpCenters({
    "up.json": { state: "Uttar Pradesh", centers: [OFFICE, { name: "No source office", type: "agriculture_office", district: "Lucknow" }] },
    "_template.example.json": { state: "EXAMPLE", centers: [OFFICE] },
  });
  const d = new HelpCenterDirectory(dir);
  assert.equal(d.rejected.length, 1);
  assert.deepEqual(d.index(), [{ state_slug: "up", state: "Uttar Pradesh", districts: ["Lucknow"] }]);
  assert.equal(d.byDistrict("up", "lucknow").length, 1);
  assert.deepEqual(validateCenter({ name: "x", type: "kvk", district: "d" }).sort(), ["source_url missing", "verified_on (YYYY-MM-DD) missing"].sort());
});

test("repository ships no real help-centre entries (nothing invented)", () => {
  const dir = path.resolve(import.meta.dirname, "../../data/help_centers");
  const real = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  assert.deepEqual(real, []);
});

test("help-centers endpoint by state/district and by coordinates", async () => {
  const app = appWith({ centers: { "up.json": { state: "UP", centers: [OFFICE] } } });
  const a = await request(app).get("/api/farmer/help-centers?state=up&district=Lucknow");
  assert.equal(a.body.centers.length, 1);
  const b = await request(app).get(`/api/farmer/help-centers?lat=${LAT}&lng=${LNG}`);
  assert.ok(b.body.centers[0].distance_m < 1000);
  assert.equal((await request(app).get("/api/farmer/help-centers?state=../../x")).status, 400);
});

test("coordinates never appear in guest request logs or error logs", async () => {
  const lines = [];
  const stream = { write: (l) => lines.push(l) };
  const origWarn = console.warn;
  const origErr = console.error;
  const captured = [];
  console.warn = (...a) => captured.push(a.join(" "));
  console.error = (...a) => captured.push(a.join(" "));
  try {
    const app = appWith({ provider: fakeProvider([], { fail: true }), logStream: stream });
    await request(app).get(`/api/farmer/shops?lat=${LAT}&lng=${LNG}`);
    await request(app).get(`/api/farmer/help-centers?lat=${LAT}&lng=${LNG}`);
  } finally {
    console.warn = origWarn;
    console.error = origErr;
  }
  const all = lines.join("\n") + captured.join("\n");
  assert.ok(lines.length >= 2, "request log lines were written");
  assert.ok(!all.includes("26.84"), "latitude leaked into logs");
  assert.ok(!all.includes("80.94"), "longitude leaked into logs");
  assert.ok(lines.every((l) => l.startsWith("- ")), "no client IP logged for farmer routes");
});

test("Overpass provider builds an around() query and parses nodes/ways", async () => {
  let sentBody;
  const provider = new OverpassShopProvider({
    url: "https://overpass.test/api",
    userAgent: "test-agent",
    fetchImpl: async (url, init) => {
      sentBody = decodeURIComponent(init.body);
      assert.equal(init.headers["User-Agent"], "test-agent");
      return {
        ok: true,
        json: async () => ({
          elements: [
            { type: "node", id: 1, lat: 26.85, lon: 80.95, tags: { shop: "agrarian", name: "Far shop", phone: "+91 1" } },
            { type: "way", id: 2, center: { lat: 26.847, lon: 80.946 }, tags: { shop: "agrarian", name: "Near shop" } },
            { type: "node", id: 3, tags: { shop: "agrarian" } },
          ],
        }),
      };
    },
  });
  const shops = await provider.search({ lat: 26.847, lng: 80.946, radiusM: 5000, limit: 5 });
  assert.match(sentBody, /shop"="agrarian"\]\(around:5000,26.847,80.946\)/);
  assert.deepEqual(shops.map((s) => s.name), ["Near shop", "Far shop"]);
  assert.equal(shops[1].phone, "+91 1");
  assert.match(shops[0].map_url, /openstreetmap\.org/);
});

test("geocode endpoint validates input", async () => {
  const app = appWith();
  assert.equal((await request(app).get("/api/farmer/geocode?q=a")).status, 400);
  const ok = await request(app).get("/api/farmer/geocode?q=Barabanki");
  assert.equal(ok.body.places[0].name, "Barabanki");
});

test("symptom question proxies validate input and forward to the ML service with the internal token", async () => {
  const { startMockMl } = await import("./helpers.js");
  const ml = await startMockMl({
    "GET /api/questions": () => [200, { pair: "p", questions: [] }],
    "POST /api/refine": (req, body) => [200, { echoed: JSON.parse(body.toString()) }],
  });
  process.env.ML_SERVICE_URL = `http://localhost:${ml.port}`;
  try {
    const app = appWith();
    const q = await request(app).get("/api/farmer/questions?a=Tomato___Late_blight&b=Tomato___Early_blight&lang=hi");
    assert.equal(q.status, 200);
    assert.match(ml.calls[0].url, /language=hi/);
    assert.equal((await request(app).get("/api/farmer/questions?a=%3Cscript%3E&b=x")).status, 400);
    const body = { candidates: [{ class_key: "Tomato___Late_blight", probability: 0.5 }, { class_key: "Tomato___Early_blight", probability: 0.4 }], answers: { q1: "yes" } };
    const r = await request(app).post("/api/farmer/refine").send(body);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.echoed, body);
    assert.equal((await request(app).post("/api/farmer/refine").send({ ...body, answers: { q1: "maybe" } })).status, 400);
  } finally {
    ml.server.close();
  }
});
