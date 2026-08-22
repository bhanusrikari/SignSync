import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES, t } from "./index";
import en from "./en.json";
import hi from "./hi.json";
import te from "./te.json";

describe("i18n translation layer", () => {
  it("looks up a key in the requested language", () => {
    expect(t("dashboard.title", "en-IN")).toBe("SignSync");
    expect(t("dashboard.captions.title", "hi-IN")).toBe("लाइव कैप्शन");
    expect(t("dashboard.captions.title", "te-IN")).toBe("లైవ్ క్యాప్షన్‌లు");
  });

  it("supports exactly en-IN, hi-IN, te-IN (TECH_SPEC.md §22)", () => {
    expect(SUPPORTED_LANGUAGES.sort()).toEqual(["en-IN", "hi-IN", "te-IN"]);
  });

  it("falls back to the raw key if even English is missing it (never throws, never blank)", () => {
    expect(t("this.key.does.not.exist", "en-IN")).toBe("this.key.does.not.exist");
    expect(t("this.key.does.not.exist", "hi-IN")).toBe("this.key.does.not.exist");
  });

  it("falls back to English for an unrecognized language code rather than throwing", () => {
    expect(t("dashboard.title", "fr-FR" as never)).toBe("SignSync");
  });

  it("every key present in the English catalog is also present in Hindi and Telugu (no silently-missing translations)", () => {
    const englishKeys = Object.keys(en);
    const missingFromHi = englishKeys.filter((key) => !(key in hi));
    const missingFromTe = englishKeys.filter((key) => !(key in te));
    expect(missingFromHi).toEqual([]);
    expect(missingFromTe).toEqual([]);
  });

  it("Hindi and Telugu never have an ORPHANED key absent from English (Phase 11 Part M) -- English is the source of truth every key must originate from", () => {
    const englishKeys = new Set(Object.keys(en));
    const orphanedInHi = Object.keys(hi).filter((key) => !englishKeys.has(key));
    const orphanedInTe = Object.keys(te).filter((key) => !englishKeys.has(key));
    expect(orphanedInHi).toEqual([]);
    expect(orphanedInTe).toEqual([]);
  });

  it("no catalog has an empty string for any key", () => {
    for (const catalog of [en, hi, te]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim().length, `key "${key}" has an empty translation`).toBeGreaterThan(0);
      }
    }
  });
});
