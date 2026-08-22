/**
 * Shared Tailwind class helpers for the three accessibility settings (Phase
 * 10 Part 11 / Phase 10.1 Part 9): high contrast, larger text, reduced
 * motion. Applied consistently across the popup, overlay, record, validate,
 * and tutorials pages so toggling a setting in one place changes every
 * SignSync surface the same way, not just the popup/overlay (Phase 10 only
 * wired these into the popup and overlay -- Phase 10.1 extends the same
 * classes to the remaining pages).
 */
import type { SignSyncState } from "@/types";

export interface AccessibilityStateSlice {
  highContrast: SignSyncState["highContrast"];
  largeText: SignSyncState["largeText"];
  reducedMotion: SignSyncState["reducedMotion"];
}

/** Base text-size + contrast classes for a full-page surface (record,
 *  validate, tutorials) -- simpler than the overlay's own
 *  `[&_*]:text-black` override (that one needs to force-override many
 *  nested Tailwind color utility classes at once; these full pages mostly
 *  don't have that same density of pre-colored nested elements). */
export function pageAccessibilityClasses(state: AccessibilityStateSlice): string {
  const size = state.largeText ? "text-base" : "text-sm";
  const contrast = state.highContrast ? "contrast-more" : "";
  return `${size} ${contrast}`.trim();
}

/** True if animations/transitions should be minimized -- callers gate
 *  `transition-*`/`animate-*` Tailwind classes on this rather than applying
 *  them unconditionally. */
export function motionEnabled(state: AccessibilityStateSlice): boolean {
  return !state.reducedMotion;
}
