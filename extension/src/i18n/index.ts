/**
 * Central translation layer (Phase 10 Part 7) -- flat key -> string
 * catalogs per language, so every user-facing surface (dashboard, settings,
 * overlay, validate, record, tutorials, onboarding, errors) pulls its text
 * from here instead of hardcoding English throughout components.
 *
 * Deliberately NOT used for developer/diagnostic output ([PERS] logs,
 * console messages, internal ids) -- those stay in English by design (Part
 * 16: developer diagnostics are a separate, English-only surface).
 *
 * Keyed by the SAME LanguageCode ("en-IN" | "hi-IN" | "te-IN") the rest of
 * the app already uses for captions/speech (see shared/constants.ts's
 * LANGUAGES, TECH_SPEC.md §22) -- one language setting drives interface
 * text, captions, and speech together, rather than three independent
 * pickers. (See the Phase 10 report for why this was a deliberate scope
 * decision rather than an oversight.)
 */
import en from "./en.json";
import hi from "./hi.json";
import te from "./te.json";
import type { LanguageCode } from "@/types";

export type TranslationKey = keyof typeof en;

const CATALOGS: Record<LanguageCode, Record<string, string>> = { "en-IN": en, "hi-IN": hi, "te-IN": te };

/**
 * Looks up `key` in `language`'s catalog, falling back to English if the
 * language is missing the key (a partially-translated catalog must never
 * show a blank or a raw key to the user), and finally falling back to the
 * key itself if even English is missing it (should never happen with a
 * valid TranslationKey, but keeps this total/never-throwing for any
 * runtime string that slips past the type check).
 */
export function t(key: TranslationKey | string, language: LanguageCode): string {
  const catalog = CATALOGS[language] ?? CATALOGS["en-IN"];
  return catalog[key] ?? CATALOGS["en-IN"][key] ?? key;
}

/** All languages this catalog actually has translations for -- distinct
 *  from shared/constants.ts's LANGUAGES (which is the source of truth for
 *  what's selectable in the UI); kept here too so a language can never be
 *  selectable without a corresponding catalog silently falling back to
 *  English for every single string. */
export const SUPPORTED_LANGUAGES: LanguageCode[] = Object.keys(CATALOGS) as LanguageCode[];
