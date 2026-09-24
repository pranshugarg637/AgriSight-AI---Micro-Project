/**
 * Auto-capture state machine. Feed it one frame assessment at a time.
 * A photo is taken once N consecutive frames are sharp, leaf-like, bright
 * enough and steady. Guidance prompts are rate-limited so the phone does not
 * talk over itself.
 */
export const REASON_TO_PROMPT = {
  too_dark: "low_light",
  no_leaf: "no_leaf",
  too_far: "come_closer",
  blurry: "hold_steady",
  moving: "hold_steady",
};

export function createCaptureMachine({ requiredGoodFrames = 4, promptCooldownMs = 4000, now = () => Date.now() } = {}) {
  let state = "framing"; // framing -> steady -> captured
  let goodFrames = 0;
  let lastPrompt = null;
  let lastPromptAt = -Infinity;

  function maybePrompt(key) {
    const t = now();
    if (key === lastPrompt && t - lastPromptAt < promptCooldownMs) return null;
    if (t - lastPromptAt < promptCooldownMs / 2) return null; // any prompt: minimum gap
    lastPrompt = key;
    lastPromptAt = t;
    return key;
  }

  return {
    get state() {
      return state;
    },
    get goodFrames() {
      return goodFrames;
    },
    onFrame(assessment) {
      if (state === "captured") return { state, capture: false, prompt: null, cue: "captured" };
      if (!assessment.ok) {
        goodFrames = 0;
        state = "framing";
        const cue = REASON_TO_PROMPT[assessment.reason] || "no_leaf";
        return { state, capture: false, prompt: maybePrompt(cue), cue };
      }
      goodFrames += 1;
      if (goodFrames >= requiredGoodFrames) {
        state = "captured";
        return { state, capture: true, prompt: "captured", cue: "captured" };
      }
      state = "steady";
      return { state, capture: false, prompt: null, cue: "steady" };
    },
    /** Manual capture button. */
    forceCapture() {
      if (state === "captured") return false;
      state = "captured";
      return true;
    },
    reset() {
      state = "framing";
      goodFrames = 0;
    },
  };
}

/** Runs `tick` every `intervalMs` until stopped. Returns stop(). */
export function startAnalysisLoop(tick, intervalMs = 333) {
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
