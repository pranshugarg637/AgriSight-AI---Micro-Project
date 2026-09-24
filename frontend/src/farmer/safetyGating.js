/**
 * Decides WHAT Farmer Mode may say, from the server result. This is the
 * safety gate for people who cannot read on-screen caveats:
 *
 *  high        -> name the disease + (only if cited KB evidence exists)
 *                 what it is and safe steps; otherwise "no reliable advice"
 *  low         -> "not sure", top possibility + alternative, caution,
 *                 then symptom questions or "visit the agriculture office"
 *  unreliable  -> never name a disease; "I cannot tell ... visit office"
 *  insufficient_evidence / knowledge_base_empty -> name only if high,
 *                 plainly say reliable advice was not found, point to office
 *
 * Returns clip keys ("<lang>.<slug>.<field>") -- the player turns them into
 * pre-generated audio (or a logged speech fallback).
 */
export function classSlug(classKey) {
  return String(classKey || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const NO_EVIDENCE = new Set(["insufficient_evidence", "knowledge_base_empty"]);

export function buildSpokenResult(result, bundle, { lang = "en", questionsAvailable = false } = {}) {
  const p = (field) => `${lang}.prompt.${field}`;
  const c = (slug, field) => `${lang}.${slug}.${field}`;
  const level = result?.confidence_level;
  const slug = classSlug(result?.class_key);
  const script = bundle?.classes?.[slug];
  const hasClip = (s, field) => Boolean(bundle?.classes?.[s]?.clips?.[field]);

  if (!result || level === "unreliable" || !script) {
    const playlist = [];
    if (result?.unreliable_reason === "not_a_leaf") playlist.push(p("not_a_leaf"));
    if (result?.unreliable_reason === "unsupported_crop") playlist.push(p("unsupported_crop"));
    playlist.push(p("cannot_tell"), p("where_help"));
    return { band: "red", level: "unreliable", showDisease: false, playlist, primaryHelp: "office", askQuestions: false, adviceSpoken: false };
  }

  if (level === "low") {
    const playlist = [p("uncertain_intro"), c(slug, "name")];
    const alt = result.alternatives?.[0];
    const altSlug = alt ? classSlug(alt.class_key || `${alt.crop}___${alt.disease}`) : null;
    if (altSlug && bundle.classes[altSlug]) playlist.push(p("alternative_intro"), c(altSlug, "name"));
    playlist.push(p("uncertain_caution"));
    playlist.push(questionsAvailable ? p("ask_questions") : p("visit_office"));
    playlist.push(p("where_help"));
    return { band: "amber", level, showDisease: true, playlist, primaryHelp: "office", askQuestions: questionsAvailable, adviceSpoken: false };
  }

  // high confidence
  const playlist = [p("result_is"), c(slug, "name"), p("sure_high")];
  if (script.healthy) {
    playlist.push(p("healthy_note"), p("try_again"));
    return { band: "green", level, showDisease: true, playlist, primaryHelp: "none", askQuestions: false, adviceSpoken: false };
  }
  let adviceSpoken = false;
  if (NO_EVIDENCE.has(result.retrieval_status)) {
    playlist.push(p("no_advice_found"), p("visit_office"));
  } else if (result.retrieval_status === "success" && hasClip(slug, "safe_steps") && script.sources?.length) {
    if (hasClip(slug, "what_it_is")) playlist.push(c(slug, "what_it_is"));
    playlist.push(p("safe_steps_intro"), c(slug, "safe_steps"), p("seek_expert"));
    adviceSpoken = true;
  } else {
    playlist.push(p("no_advice_found"), p("visit_office"));
  }
  playlist.push(p("where_help"));
  return {
    band: "green",
    level,
    showDisease: true,
    playlist,
    primaryHelp: adviceSpoken ? "shops" : "office",
    askQuestions: false,
    adviceSpoken,
  };
}

/** Text for a clip key from the script bundle (used for captions + speech fallback). */
export function clipText(bundle, key) {
  const [, slug, field] = String(key).split(".");
  if (!bundle) return "";
  if (slug === "prompt") return bundle.prompts?.[field] || "";
  return bundle.classes?.[slug]?.clips?.[field] || "";
}
