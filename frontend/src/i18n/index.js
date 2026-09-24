/**
 * i18n bootstrap.
 *
 * Adding a language = drop ONE file into ./locales/<code>.json (with a
 * "_meta" block: nativeName, dir) and add its audio scripts folder. Locale
 * files are discovered automatically; missing keys fall back to English.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const modules = import.meta.glob("./locales/*.json", { eager: true });

export const resources = {};
export const LANGUAGES = [];
for (const [path, mod] of Object.entries(modules)) {
  const code = path.match(/\/([a-zA-Z-]+)\.json$/)[1];
  const data = mod.default || mod;
  resources[code] = { translation: data };
  LANGUAGES.push({
    code,
    nativeName: data._meta?.nativeName || code,
    dir: data._meta?.dir || "ltr",
    speechLang: data._meta?.speechLang || code,
  });
}
// English first, then by code, so the picker order is stable.
LANGUAGES.sort((a, b) => (a.code === "en" ? -1 : b.code === "en" ? 1 : a.code.localeCompare(b.code)));

export const STORAGE_KEY = "agrisight.language";
export const DEFAULT_LANGUAGE = "en";

export function readStoredLanguage() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && resources[v] ? v : null;
  } catch {
    return null;
  }
}

export function storeLanguage(code) {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* private mode / blocked storage: the choice just is not remembered */
  }
}

export function languageMeta(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES.find((l) => l.code === DEFAULT_LANGUAGE);
}

/** Applies <html lang/dir> so screen readers, fonts and RTL layouts follow the language. */
export function applyDocumentLanguage(code) {
  if (typeof document === "undefined") return;
  const meta = languageMeta(code);
  document.documentElement.lang = meta.code;
  document.documentElement.dir = meta.dir;
}

export async function changeLanguage(code, { persist = true } = {}) {
  if (!resources[code]) code = DEFAULT_LANGUAGE;
  await i18n.changeLanguage(code);
  applyDocumentLanguage(code);
  if (persist) storeLanguage(code);
  return code;
}

i18n.use(initReactI18next).init({
  resources,
  lng: readStoredLanguage() || DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
  returnNull: false,
});
applyDocumentLanguage(i18n.language);

export default i18n;
