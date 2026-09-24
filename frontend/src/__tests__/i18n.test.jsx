import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n, { LANGUAGES, resources, changeLanguage, STORAGE_KEY, readStoredLanguage } from "../i18n";
import LanguagePicker from "../components/LanguagePicker";
import ExplanationSections from "../components/ExplanationSections";
import { renderWithProviders, DEMO_USER } from "../test-utils";
import AccountLayout from "../pages/account/AccountLayout";
import * as authApi from "../api/auth";

function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    k === "_meta" ? [] : typeof v === "object" ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("locales", () => {
  it("discovers en and hi and names each language in its own script", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes[0]).toBe("en");
    expect(codes).toContain("hi");
    expect(LANGUAGES.find((l) => l.code === "hi").nativeName).toBe("हिन्दी");
  });

  it("every Hindi key exists in English (English is the fallback source)", () => {
    const en = new Set(flatKeys(resources.en.translation));
    const extra = flatKeys(resources.hi.translation).filter((k) => !en.has(k));
    expect(extra).toEqual([]);
  });

  it("reports keys missing from Hindi (they fall back to English, never blank)", () => {
    const hi = new Set(flatKeys(resources.hi.translation));
    const missing = flatKeys(resources.en.translation).filter((k) => !hi.has(k));
    // Not an error -- but every missing key must render as English.
    for (const key of missing) {
      expect(i18n.getFixedT("hi")(key)).toBe(i18n.getFixedT("en")(key));
    }
  });

  it("missing key in the active language falls back to English", async () => {
    i18n.addResource("en", "translation", "test.onlyEnglish", "Only in English");
    await changeLanguage("hi");
    expect(i18n.t("test.onlyEnglish")).toBe("Only in English");
    expect(i18n.t("landing.farmer")).toBe("मैं किसान हूँ");
  });

  it("unknown language codes fall back to English", async () => {
    expect(await changeLanguage("xx")).toBe("en");
  });
});

describe("language persistence", () => {
  it("guest choice is stored in localStorage and applied to <html lang>", async () => {
    render(<LanguagePicker />);
    fireEvent.click(screen.getByRole("button", { name: "हिन्दी" }));
    await waitFor(() => expect(document.documentElement.lang).toBe("hi"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("hi");
    expect(readStoredLanguage()).toBe("hi");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("works when localStorage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(changeLanguage("hi")).resolves.toBe("hi");
  });

  it("signed-in users save the choice to their profile", async () => {
    const spy = vi.spyOn(authApi, "updateMe").mockResolvedValue({ user: { ...DEMO_USER, preferred_language: "hi" } });
    renderWithProviders(<AccountLayout />, { route: "/account", user: DEMO_USER });
    fireEvent.click(await screen.findByRole("button", { name: "हिन्दी" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ preferred_language: "hi" }));
  });
});

describe("translated explanation", () => {
  it("shows the English source beside the translation", () => {
    render(
      <ExplanationSections
        explanation={"## What is happening?\nSpots."}
        translated={"## क्या हो रहा है?\nधब्बे।"}
        translationBackend="indictrans2"
        translationStatus="translated"
        retrievalStatus="success"
      />
    );
    expect(screen.getByText("English (source)")).toBeInTheDocument();
    expect(screen.getByText("What is happening?")).toBeInTheDocument();
    expect(screen.getByText("क्या हो रहा है?")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/indictrans2/);
  });

  it("says so when translation was unavailable", () => {
    render(<ExplanationSections explanation={"## A\nB"} translationStatus="unavailable" retrievalStatus="success" />);
    expect(screen.getByRole("note")).toHaveTextContent(/not available/i);
  });
});
