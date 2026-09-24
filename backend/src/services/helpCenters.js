import fs from "fs";
import path from "path";
import { config } from "../config/index.js";
import { haversineMeters, osmMapUrl } from "./geo.js";

/**
 * Curated agriculture offices / Krishi Vigyan Kendras, one file per state:
 *   data/help_centers/<state_slug>.json
 * Files starting with "_" (schema, template) are ignored. Entries without a
 * source_url and verified_on date are REJECTED -- this list must only ever
 * contain data a person copied from an official directory.
 */
const TYPES = new Set(["kvk", "agriculture_office", "helpline", "other"]);

export function validateCenter(c) {
  const errors = [];
  if (!c || typeof c !== "object") return ["not an object"];
  if (!c.name || typeof c.name !== "string") errors.push("name missing");
  if (!TYPES.has(c.type)) errors.push(`type must be one of ${[...TYPES].join("/")}`);
  if (!c.district && c.type !== "helpline") errors.push("district missing");
  if (!c.source_url || !/^https?:\/\//.test(c.source_url)) errors.push("source_url missing");
  if (!c.verified_on || !/^\d{4}-\d{2}-\d{2}$/.test(c.verified_on)) errors.push("verified_on (YYYY-MM-DD) missing");
  if ((c.lat != null || c.lng != null) && !(Number.isFinite(c.lat) && Number.isFinite(c.lng))) errors.push("lat/lng invalid");
  return errors;
}

export function loadHelpCenters(dir = config.help.helpCentersDir) {
  const states = {};
  const rejected = [];
  if (!fs.existsSync(dir)) return { states, rejected };
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch (e) {
      rejected.push({ file: f, errors: [`invalid JSON: ${e.message}`] });
      continue;
    }
    const slug = path.basename(f, ".json");
    const centers = [];
    for (const [i, c] of (doc.centers || []).entries()) {
      const errors = validateCenter(c);
      if (errors.length) rejected.push({ file: f, index: i, errors });
      else centers.push({ ...c, state: doc.state || slug });
    }
    states[slug] = { state: doc.state || slug, centers };
  }
  if (rejected.length) console.warn(`[help-centers] rejected ${rejected.length} entr(y/ies) without a source; see docs/HUMAN_TODO.md`);
  return { states, rejected };
}

export class HelpCenterDirectory {
  constructor(dir) {
    this.dir = dir;
    this.reload();
  }
  reload() {
    const { states, rejected } = loadHelpCenters(this.dir);
    this.states = states;
    this.rejected = rejected;
  }
  index() {
    return Object.entries(this.states).map(([slug, s]) => ({
      state_slug: slug,
      state: s.state,
      districts: [...new Set(s.centers.map((c) => c.district).filter(Boolean))].sort(),
    }));
  }
  all() {
    return Object.values(this.states).flatMap((s) => s.centers);
  }
  byDistrict(stateSlug, district) {
    const s = this.states[stateSlug];
    if (!s) return [];
    const d = String(district || "").toLowerCase();
    return s.centers.filter((c) => c.type === "helpline" || !d || String(c.district).toLowerCase() === d);
  }
  nearest(lat, lng, limit = 3) {
    return this.all()
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => ({ ...c, distance_m: Math.round(haversineMeters(lat, lng, c.lat, c.lng)), map_url: osmMapUrl(c.lat, c.lng) }))
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);
  }
}
