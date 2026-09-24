import { BACKEND_URL } from "../api/http";
import { clipText } from "./safetyGating";

/**
 * Plays a list of clip keys in order. Pre-generated audio files are always
 * preferred; if a clip is missing (or fails to play) the browser's Web
 * Speech API speaks the script text instead, and that fallback is logged
 * (console + backend) so missing clips get generated.
 */
export class ClipPlayer {
  constructor({
    bundle = null,
    speechLang = "en-IN",
    createAudio = () => new Audio(),
    speech = typeof window !== "undefined" ? window.speechSynthesis : undefined,
    reportFallback = defaultReportFallback,
    baseUrl = BACKEND_URL,
  } = {}) {
    this.bundle = bundle;
    this.speechLang = speechLang;
    this.createAudio = createAudio;
    this.speech = speech;
    this.reportFallback = reportFallback;
    this.baseUrl = baseUrl;
    this.lastPlaylist = [];
    this.generation = 0;
    this.current = null;
    this.onClip = null; // (key, text) => void, for captions
  }

  setCaptionListener(fn) {
    this.onClip = fn;
  }

  setBundle(bundle, speechLang) {
    this.bundle = bundle;
    if (speechLang) this.speechLang = speechLang;
  }

  available(key) {
    return Boolean(this.bundle?.available_clips?.includes(key));
  }

  stop() {
    this.generation += 1;
    if (this.current) {
      try {
        this.current.pause();
      } catch {
        /* ignore */
      }
      this.current = null;
    }
    try {
      this.speech?.cancel();
    } catch {
      /* ignore */
    }
  }

  async play(keys) {
    this.stop();
    const gen = this.generation;
    this.lastPlaylist = [...keys];
    for (const key of keys) {
      if (gen !== this.generation) return false; // interrupted
      const text = clipText(this.bundle, key);
      this.onClip?.(key, text);
      let ok = false;
      if (this.available(key)) ok = await this.playFile(key);
      if (!ok && gen === this.generation) await this.speakFallback(key, text);
    }
    return gen === this.generation;
  }

  replay() {
    return this.play(this.lastPlaylist);
  }

  playFile(key) {
    return new Promise((resolve) => {
      const audio = this.createAudio();
      this.current = audio;
      const done = (ok) => {
        audio.onended = null;
        audio.onerror = null;
        resolve(ok);
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.src = `${this.baseUrl}/api/farmer/audio/${encodeURIComponent(key)}`;
      const p = audio.play?.();
      if (p && typeof p.catch === "function") p.catch(() => done(false));
    });
  }

  speakFallback(key, text) {
    console.warn(`[audio] clip missing or unplayable, using Web Speech fallback: ${key}`);
    this.reportFallback(key);
    if (!text || !this.speech || typeof SpeechSynthesisUtterance === "undefined") return Promise.resolve(false);
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.speechLang;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      this.speech.speak(u);
    });
  }
}

function defaultReportFallback(key) {
  try {
    fetch(`${BACKEND_URL}/api/farmer/audio-fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
