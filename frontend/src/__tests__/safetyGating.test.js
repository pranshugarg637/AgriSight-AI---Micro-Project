import { describe, it, expect } from "vitest";
import { buildSpokenResult, clipText, classSlug } from "../farmer/safetyGating";

const bundle = {
  prompts: { cannot_tell: "I cannot tell..." },
  classes: {
    tomato_late_blight: { class_key: "Tomato___Late_blight", clips: { name: "Tomato: late blight", what_it_is: "x", safe_steps: "y" }, sources: [{ file: "a.pdf" }] },
    tomato_early_blight: { class_key: "Tomato___Early_blight", clips: { name: "Tomato: early blight", what_it_is: null, safe_steps: null }, sources: [] },
    tomato_healthy: { class_key: "Tomato___healthy", healthy: true, clips: { name: "Healthy tomato leaf" }, sources: [] },
    apple_black_rot: { class_key: "Apple___Black_rot", clips: { name: "Apple: black rot", safe_steps: null }, sources: [] },
  },
};
const base = { class_key: "Tomato___Late_blight", crop: "Tomato", diagnosis: "Late blight", alternatives: [] };
const noDisease = (g) => g.playlist.every((k) => !k.includes("tomato_") && !k.includes("apple_"));

describe("Farmer Mode safety gating", () => {
  it("high + success + cited steps -> name, what it is, safe steps, shops primary", () => {
    const g = buildSpokenResult({ ...base, confidence_level: "high", retrieval_status: "success" }, bundle, { lang: "hi" });
    expect(g.band).toBe("green");
    expect(g.playlist).toEqual([
      "hi.prompt.result_is",
      "hi.tomato_late_blight.name",
      "hi.prompt.sure_high",
      "hi.tomato_late_blight.what_it_is",
      "hi.prompt.safe_steps_intro",
      "hi.tomato_late_blight.safe_steps",
      "hi.prompt.seek_expert",
      "hi.prompt.where_help",
    ]);
    expect(g.primaryHelp).toBe("shops");
    expect(g.adviceSpoken).toBe(true);
  });

  it("high but no script steps for the class -> no invented advice, office primary", () => {
    const g = buildSpokenResult({ ...base, class_key: "Apple___Black_rot", confidence_level: "high", retrieval_status: "success" }, bundle);
    expect(g.playlist).toContain("en.prompt.no_advice_found");
    expect(g.playlist).toContain("en.prompt.visit_office");
    expect(g.playlist.some((k) => k.endsWith("safe_steps"))).toBe(false);
    expect(g.primaryHelp).toBe("office");
  });

  it.each(["insufficient_evidence", "knowledge_base_empty"])("high + %s -> disease name, plainly no advice, office", (status) => {
    const g = buildSpokenResult({ ...base, confidence_level: "high", retrieval_status: status }, bundle);
    expect(g.playlist).toContain("en.tomato_late_blight.name");
    expect(g.playlist).toContain("en.prompt.no_advice_found");
    expect(g.playlist).toContain("en.prompt.visit_office");
    expect(g.playlist.some((k) => k.endsWith("safe_steps") || k.endsWith("what_it_is"))).toBe(false);
    expect(g.primaryHelp).toBe("office");
  });

  it("low -> uncertain, top + alternative, caution, questions or office; never advice", () => {
    const r = {
      ...base,
      confidence_level: "low",
      retrieval_status: "success",
      alternatives: [{ crop: "Tomato", disease: "Early blight", class_key: "Tomato___Early_blight", confidence: 0.3 }],
    };
    const g = buildSpokenResult(r, bundle);
    expect(g.band).toBe("amber");
    expect(g.playlist).toEqual([
      "en.prompt.uncertain_intro",
      "en.tomato_late_blight.name",
      "en.prompt.alternative_intro",
      "en.tomato_early_blight.name",
      "en.prompt.uncertain_caution",
      "en.prompt.visit_office",
      "en.prompt.where_help",
    ]);
    expect(g.primaryHelp).toBe("office");
    const withQ = buildSpokenResult(r, bundle, { questionsAvailable: true });
    expect(withQ.playlist).toContain("en.prompt.ask_questions");
    expect(withQ.askQuestions).toBe(true);
  });

  it.each([undefined, "not_a_leaf", "unsupported_crop", "low_confidence"])("unreliable (%s) -> never names a disease", (reason) => {
    const g = buildSpokenResult({ ...base, confidence_level: "unreliable", unreliable_reason: reason, retrieval_status: "skipped_low_confidence" }, bundle);
    expect(g.band).toBe("red");
    expect(g.showDisease).toBe(false);
    expect(noDisease(g)).toBe(true);
    expect(g.playlist).toContain("en.prompt.cannot_tell");
    expect(g.primaryHelp).toBe("office");
    if (reason === "not_a_leaf") expect(g.playlist[0]).toBe("en.prompt.not_a_leaf");
  });

  it("unknown class (no script) is treated as cannot-tell", () => {
    const g = buildSpokenResult({ ...base, class_key: "Mango___X", confidence_level: "high", retrieval_status: "success" }, bundle);
    expect(g.showDisease).toBe(false);
  });

  it("healthy leaf -> no help push", () => {
    const g = buildSpokenResult({ ...base, class_key: "Tomato___healthy", confidence_level: "high", retrieval_status: "success" }, bundle);
    expect(g.playlist).toContain("en.prompt.healthy_note");
    expect(g.primaryHelp).toBe("none");
  });

  it("clip text lookup and slugs", () => {
    expect(clipText(bundle, "en.prompt.cannot_tell")).toBe("I cannot tell...");
    expect(clipText(bundle, "en.tomato_late_blight.name")).toBe("Tomato: late blight");
    expect(classSlug("Corn_(maize)___Common_rust_")).toBe("corn_maize_common_rust");
  });
});
