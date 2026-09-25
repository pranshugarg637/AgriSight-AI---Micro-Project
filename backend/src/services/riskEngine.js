import fs from "fs";
import path from "path";
import { config } from "../config/index.js";

/**
 * Weather-based disease RISK INDICATOR (rules, not ML, not a prediction).
 *
 * Each rule (knowledge_base/risk_rules/*.json) states which hourly weather
 * conditions a cited document describes as favourable for a disease, using
 * ONLY numbers that appear in the cited text. The engine counts forecast
 * hours matching all conditions, per day, and reports:
 *   favourable_conditions_forecast  (>= min_matching_hours hours on that day)
 *   no_matching_conditions
 * together with the exact rule and citation. Rules without a citation are
 * refused; placeholder-sourced rules are refused in production.
 */
const CONDITION_FIELDS = {
  temperature_c: "temperature_c",
  relative_humidity: "relative_humidity",
  precipitation_mm: "precipitation_mm",
};

export function validateRule(rule) {
  const errors = [];
  if (!rule.id) errors.push("id missing");
  if (!rule.class_key) errors.push("class_key missing");
  const c = rule.citation;
  if (!c || !c.file || !c.quote) errors.push("citation {file, page, quote} required");
  const conds = rule.conditions || {};
  if (!Object.keys(conds).length) errors.push("conditions missing");
  for (const [field, cond] of Object.entries(conds)) {
    if (!CONDITION_FIELDS[field]) errors.push(`unknown condition ${field}`);
    const keys = Object.keys(cond || {});
    if (!keys.length || keys.some((k) => !["min", "max", "gt", "gte", "lt"].includes(k))) errors.push(`bad bounds for ${field}`);
  }
  return errors;
}

export function loadRules(dir = config.weather.riskRulesDir, { production = config.isProduction } = {}) {
  const rules = [];
  const rejected = [];
  if (!fs.existsSync(dir)) return { rules, rejected };
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    let rule;
    try {
      rule = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch (e) {
      rejected.push({ file: f, errors: [`invalid JSON: ${e.message}`] });
      continue;
    }
    const errors = validateRule(rule);
    if (rule.source_is_placeholder && production) errors.push("placeholder source refused in production");
    if (errors.length) rejected.push({ file: f, errors });
    else rules.push({ ...rule, file: f });
  }
  if (rejected.length) console.warn(`[risk] refused ${rejected.length} rule file(s): ${rejected.map((r) => r.file).join(", ")}`);
  return { rules, rejected };
}

function hourMatches(hour, conditions) {
  for (const [field, b] of Object.entries(conditions)) {
    const v = hour[CONDITION_FIELDS[field]];
    if (v === null || v === undefined) return false;
    if (b.min !== undefined && v < b.min) return false;
    if (b.max !== undefined && v > b.max) return false;
    if (b.gt !== undefined && !(v > b.gt)) return false;
    if (b.gte !== undefined && v < b.gte) return false;
    if (b.lt !== undefined && !(v < b.lt)) return false;
  }
  return true;
}

export function evaluateRule(rule, hourly) {
  const byDay = new Map();
  for (const h of hourly) {
    const day = String(h.time).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { date: day, hours: 0, matching_hours: 0 });
    const d = byDay.get(day);
    d.hours += 1;
    if (hourMatches(h, rule.conditions)) d.matching_hours += 1;
  }
  const min = rule.min_matching_hours ?? 1;
  const days = [...byDay.values()].map((d) => ({
    ...d,
    level: d.matching_hours >= min ? "favourable_conditions_forecast" : "no_matching_conditions",
  }));
  return {
    rule_id: rule.id,
    class_key: rule.class_key,
    description: rule.description,
    conditions: rule.conditions,
    min_matching_hours: min,
    citation: rule.citation,
    source_is_placeholder: Boolean(rule.source_is_placeholder),
    interpretation_notes: rule.interpretation_notes || null,
    days,
    any_favourable: days.some((d) => d.level === "favourable_conditions_forecast"),
  };
}

export function rulesForCrop(rules, crop) {
  const c = String(crop || "").toLowerCase();
  if (!c) return rules;
  return rules.filter((r) => String(r.class_key).toLowerCase().startsWith(c.replace(/\s+/g, "_")));
}

export function assessRisk(rules, weather) {
  return {
    label: "risk indicator",
    disclaimer:
      "This is a weather-based risk indicator from documented conditions, not a prediction that the disease will appear.",
    weather_available: weather.available,
    weather_source: weather.attribution || weather.source,
    results: weather.available ? rules.map((r) => evaluateRule(r, weather.hourly)) : [],
  };
}
