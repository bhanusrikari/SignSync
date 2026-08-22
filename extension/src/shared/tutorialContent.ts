/**
 * Data model for the Learn Sign Language hub (Phase 10 Part 6). Pure data
 * + lookup helpers, no chrome/DOM APIs -- consumed by src/tutorials/App.tsx.
 *
 * IMPORTANT (Phase 10 Part 6/19): TUTORIAL_SIGNS is deliberately EMPTY.
 * SignSync does not fabricate or guess sign-language definitions -- ASL and
 * ISL are real languages with real linguistic structure, and an incorrect
 * "demonstration" would actively mislead a learner. This module exists so
 * the tutorial hub has a real, typed, extensible structure (region ->
 * category -> sign) ready to be populated from a verified resource/catalog
 * later (see the Phase 10 report's Remaining PRD Gaps), while today it
 * honestly shows a "coming soon" empty state per category instead of
 * placeholder content.
 *
 * This is completely separate from a user's own PersonalizedGesture
 * records (see types/index.ts) -- those are the USER's own custom
 * gestures, taught to SignSync by the user themself, never claimed to be
 * verified sign-language signs. src/tutorials/App.tsx displays both, but
 * visibly labels personalized gestures with tutorials.customGestureNote
 * (see i18n) so the distinction is never ambiguous to the user.
 */

export type TutorialRegion = "ASL" | "ISL";

export interface TutorialRegionInfo {
  id: TutorialRegion;
  flag: string;
  /** i18n key (src/i18n/*.json) for this region's display name -- see
   *  Phase 10.1: region names are now localized, not hardcoded English. */
  nameKey: string;
}

/** ISL listed first (Phase 10.1) -- SignSync's primary documented audience
 *  (TECH_SPEC.md's Future Scope explicitly calls out Indian Sign Language),
 *  ASL second. */
export const TUTORIAL_REGIONS: TutorialRegionInfo[] = [
  { id: "ISL", flag: "🇮🇳", nameKey: "tutorials.region.isl" },
  { id: "ASL", flag: "🇺🇸", nameKey: "tutorials.region.asl" },
];

export interface TutorialCategoryInfo {
  id: string;
  emoji: string;
  /** i18n key (src/i18n/*.json) for this category's label. */
  labelKey: string;
}

export const TUTORIAL_CATEGORIES: TutorialCategoryInfo[] = [
  { id: "greetings", emoji: "👋", labelKey: "tutorials.category.greetings" },
  { id: "people", emoji: "🧑‍🤝‍🧑", labelKey: "tutorials.category.people" },
  { id: "family", emoji: "👨‍👩‍👧", labelKey: "tutorials.category.family" },
  { id: "numbers", emoji: "🔢", labelKey: "tutorials.category.numbers" },
  { id: "food", emoji: "🍎", labelKey: "tutorials.category.food" },
  { id: "places", emoji: "📍", labelKey: "tutorials.category.places" },
  { id: "actions", emoji: "🏃", labelKey: "tutorials.category.actions" },
  { id: "questions", emoji: "❓", labelKey: "tutorials.category.questions" },
  { id: "everyday", emoji: "🗣️", labelKey: "tutorials.category.everyday" },
  { id: "useful", emoji: "💡", labelKey: "tutorials.category.useful" },
];

/**
 * One verified tutorial sign entry: name, meaning, an optional
 * demonstration video/image, and a short explanation. `videoUrl`/`imageUrl`
 * are intentionally plain strings (not bundled media) so a future verified
 * catalog can point at real, licensed demonstration content without
 * requiring a code change here -- this module only defines the SHAPE, not
 * where the data lives. `source`/`license` are required to be filled in
 * alongside `name`/`meaning` for any REAL entry added later (Phase 11 Part
 * D) -- SignSync must always be able to say where a sign came from and
 * under what terms, not just show it.
 */
export interface TutorialSign {
  id: string;
  region: TutorialRegion;
  categoryId: string;
  name: string;
  meaning: string;
  description?: string;
  videoUrl?: string;
  imageUrl?: string;
  /** Where this sign's demonstration/definition came from (e.g. an
   *  organization or published dictionary name) -- shown to the learner so
   *  they know it's a verified source, not a guess. */
  source?: string;
  /** License/attribution text for `videoUrl`/`imageUrl`/the definition
   *  itself (e.g. "CC BY-SA 4.0 -- ISLRTC"), shown alongside the sign. */
  license?: string;
}

/** Deliberately empty -- see this file's header. */
export const TUTORIAL_SIGNS: TutorialSign[] = [];

export function getSignsForCategory(region: TutorialRegion, categoryId: string): TutorialSign[] {
  return TUTORIAL_SIGNS.filter((sign) => sign.region === region && sign.categoryId === categoryId);
}

export function hasAnyContentForRegion(region: TutorialRegion): boolean {
  return TUTORIAL_SIGNS.some((sign) => sign.region === region);
}
