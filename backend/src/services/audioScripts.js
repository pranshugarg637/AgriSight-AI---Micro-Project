import fs from "fs";
import path from "path";
import { config } from "../config/index.js";

/**
 * Pre-authored spoken scripts (audio_scripts/<lang>/*.json) and the
 * pre-generated clips made from them (audio_clips/<lang>/<slug>/<field>.<ext>).
 *
 * Farmer Mode never speaks live LLM/translation output: only these reviewed
 * (or clearly flagged as unreviewed) scripts, played from clip files, with
 * the browser's Web Speech API as a logged fallback when a clip is missing.
 */
export const CLIP_EXTENSIONS = [".mp3", ".ogg", ".wav"];
const CONTENT_TYPES = { ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav" };
export const KEY_PATTERN = /^([a-z]{2,3})\.([a-z0-9_]{1,80})\.([a-z_]{1,40})$/;

export function classSlug(classKey) {
  return String(classKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function parseClipKey(key) {
  const m = KEY_PATTERN.exec(String(key || ""));
  if (!m) return null;
  return { lang: m[1], slug: m[2], field: m[3] };
}

const cache = new Map();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/** Clips that exist on disk for a language: Set of "lang.slug.field". */
export function listAvailableClips(lang, clipsDir = config.audio.clipsDir) {
  const out = new Set();
  const langDir = path.join(clipsDir, lang);
  if (!fs.existsSync(langDir)) return out;
  for (const slug of fs.readdirSync(langDir)) {
    const dir = path.join(langDir, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const ext = path.extname(f);
      if (CLIP_EXTENSIONS.includes(ext)) out.add(`${lang}.${slug}.${path.basename(f, ext)}`);
    }
  }
  return out;
}

/**
 * Bundle for one language: prompts + every class script. In production,
 * safe-step/what-it-is text that comes only from placeholder documents is
 * removed (never spoken), and flagged.
 */
export function loadScriptBundle(lang, { scriptsDir = config.audio.scriptsDir, clipsDir = config.audio.clipsDir, production = config.isProduction } = {}) {
  const cacheKey = `${lang}|${scriptsDir}|${production}`;
  if (cache.has(cacheKey) && !config.isTest) return cache.get(cacheKey);

  const dir = path.join(scriptsDir, lang);
  if (!/^[a-z]{2,3}$/.test(lang) || !fs.existsSync(dir)) return null;

  const bundle = { language: lang, prompts: {}, classes: {}, unreviewed: [], available_clips: [] };
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const doc = readJson(path.join(dir, f));
    if (!doc.reviewed_by_native_speaker) bundle.unreviewed.push(f);
    if (doc.kind === "prompts") {
      bundle.prompts = doc.clips || {};
      continue;
    }
    if (doc.kind !== "class") continue;
    const clips = { ...(doc.clips || {}) };
    let suppressed = false;
    if (doc.source_is_placeholder && production) {
      clips.what_it_is = null;
      clips.safe_steps = null;
      suppressed = true;
    }
    bundle.classes[doc.slug] = {
      class_key: doc.class_key,
      healthy: Boolean(doc.healthy),
      clips,
      sources: doc.sources || [],
      source_is_placeholder: Boolean(doc.source_is_placeholder),
      placeholder_suppressed: suppressed,
      reviewed_by_native_speaker: Boolean(doc.reviewed_by_native_speaker),
    };
  }
  bundle.available_clips = [...listAvailableClips(lang, clipsDir)].sort();
  cache.set(cacheKey, bundle);
  return bundle;
}

/** Resolve a clip key to a file on disk (or null). Never escapes clipsDir. */
export function resolveClip(key, clipsDir = config.audio.clipsDir) {
  const parsed = parseClipKey(key);
  if (!parsed) return { error: "invalid_key" };
  for (const ext of CLIP_EXTENSIONS) {
    const file = path.join(clipsDir, parsed.lang, parsed.slug, parsed.field + ext);
    if (!file.startsWith(path.resolve(clipsDir) + path.sep)) return { error: "invalid_key" };
    if (fs.existsSync(file)) return { file, contentType: CONTENT_TYPES[ext] };
  }
  return { missing: true, ...parsed };
}

export function clearScriptCache() {
  cache.clear();
}
