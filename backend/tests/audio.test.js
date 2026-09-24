import "./setup-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { makeDb } from "./helpers.js";
import { createApp } from "../src/app.js";
import { classSlug, parseClipKey, loadScriptBundle, resolveClip } from "../src/services/audioScripts.js";

let db, app;
before(async () => {
  db = await makeDb();
  app = createApp({ db });
});
after(async () => db.destroy());

test("class slugs are stable and filesystem-safe", () => {
  assert.equal(classSlug("Tomato___Late_blight"), "tomato_late_blight");
  assert.equal(classSlug("Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot"), "corn_maize_cercospora_leaf_spot_gray_leaf_spot");
  assert.equal(classSlug("Pepper,_bell___healthy"), "pepper_bell_healthy");
});

test("clip keys are validated (no path traversal)", () => {
  assert.deepEqual(parseClipKey("hi.prompt.cannot_tell"), { lang: "hi", slug: "prompt", field: "cannot_tell" });
  assert.equal(parseClipKey("../../etc.passwd.x"), null);
  assert.equal(parseClipKey("hi.prompt"), null);
  assert.equal(resolveClip("hi..x").error, "invalid_key");
});

test("GET /api/farmer/audio/:key serves a pre-generated clip with caching headers, no login", async () => {
  const res = await request(app).get("/api/farmer/audio/en.prompt.cannot_tell");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /audio\//);
  assert.match(res.headers["cache-control"], /max-age=\d+/);
});

test("missing clip -> 404 (client falls back to Web Speech); bad key -> 400", async () => {
  assert.equal((await request(app).get("/api/farmer/audio/en.prompt.does_not_exist")).status, 404);
  assert.equal((await request(app).get("/api/farmer/audio/..%2F..%2Fsecret")).status, 400);
});

test("script bundle has prompts, all classes, unreviewed flags and available clips", async () => {
  const res = await request(app).get("/api/farmer/audio-scripts/hi");
  assert.equal(res.status, 200);
  assert.ok(res.body.prompts.cannot_tell);
  assert.equal(Object.keys(res.body.classes).length, 38);
  assert.ok(res.body.unreviewed.length > 0, "hindi drafts are flagged unreviewed");
  assert.ok(res.body.available_clips.includes("hi.prompt.cannot_tell"));
  assert.equal((await request(app).get("/api/farmer/audio-scripts/xx")).status, 404);
});

test("only KB-sourced classes have safe steps; placeholder-sourced steps are removed in production", () => {
  const dev = loadScriptBundle("en", { production: false });
  assert.ok(dev.classes.tomato_late_blight.clips.safe_steps);
  assert.equal(dev.classes.tomato_late_blight.source_is_placeholder, true);
  assert.equal(dev.classes.apple_black_rot.clips.safe_steps, null, "no document -> no advice");
  const prod = loadScriptBundle("en", { production: true });
  assert.equal(prod.classes.tomato_late_blight.clips.safe_steps, null);
  assert.equal(prod.classes.tomato_late_blight.placeholder_suppressed, true);
});

test("every class with safe steps cites at least one source", () => {
  for (const lang of ["en", "hi"]) {
    const b = loadScriptBundle(lang, { production: false });
    for (const [slug, c] of Object.entries(b.classes)) {
      if (c.clips.safe_steps || c.clips.what_it_is) assert.ok(c.sources.length > 0, `${lang}/${slug} has advice without a source`);
    }
  }
});

test("scripts directory override works (adding a language = one folder)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scripts-"));
  fs.mkdirSync(path.join(dir, "mr"));
  fs.writeFileSync(path.join(dir, "mr", "_prompts.json"), JSON.stringify({ kind: "prompts", clips: { cannot_tell: "..." } }));
  const b = loadScriptBundle("mr", { scriptsDir: dir, clipsDir: dir, production: false });
  assert.equal(b.prompts.cannot_tell, "...");
});
