import "@testing-library/jest-dom";
import i18n from "./i18n";
import { afterEach } from "vitest";

// Every test starts in English unless it switches language itself.
await i18n.changeLanguage("en");
afterEach(async () => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});
