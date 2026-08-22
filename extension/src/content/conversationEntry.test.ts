import { describe, expect, it } from "vitest";
import {
  appendConversationEntry,
  gestureConversationEntry,
  personalizedConversationEntry,
  speechConversationEntry,
} from "./conversationEntry";
import type { CaptionUpdatePayload, ConversationEntry, GestureDetectedPayload, PersonalizedGestureDetectedPayload } from "@/types";

describe("gestureConversationEntry (Phase 10.1 Part 4)", () => {
  it("builds a gesture entry with the localized text for a recognized gesture", () => {
    const payload: GestureDetectedPayload = { gesture: "OPEN_PALM", text: "Hello", confidence: 0.9, timestamp: 111 };
    const entry = gestureConversationEntry(payload, "hi-IN");
    expect(entry).toEqual({ text: "नमस्ते", source: "gesture", language: "hi-IN", timestamp: 111 });
  });

  it("returns null for UNKNOWN -- it never joins the conversation", () => {
    const payload: GestureDetectedPayload = { gesture: "UNKNOWN", text: null, confidence: 0, timestamp: 222 };
    expect(gestureConversationEntry(payload, "en-IN")).toBeNull();
  });
});

describe("personalizedConversationEntry (Phase 10.1 Part 4, Phase 11 Part B)", () => {
  it("always builds an entry using the payload's own already-localized meaning and language", () => {
    const payload: PersonalizedGestureDetectedPayload = {
      gestureId: "g1",
      name: "super",
      meaning: "Great!",
      language: "en-IN",
      confidence: 0.91,
      distance: 0.03,
      timestamp: 333,
    };
    const entry = personalizedConversationEntry(payload);
    expect(entry).toEqual({ text: "Great!", source: "gesture", language: "en-IN", timestamp: 333 });
  });

  it("uses the payload's language even when it differs from the current UI language", () => {
    const payload: PersonalizedGestureDetectedPayload = {
      gestureId: "g1",
      name: "super",
      meaning: "बहुत बढ़िया!",
      language: "hi-IN",
      confidence: 0.91,
      distance: 0.03,
      timestamp: 334,
    };
    const entry = personalizedConversationEntry(payload);
    expect(entry).toEqual({ text: "बहुत बढ़िया!", source: "gesture", language: "hi-IN", timestamp: 334 });
  });
});

describe("speechConversationEntry (Phase 10.1 Part 4)", () => {
  const base: CaptionUpdatePayload = { text: "Hello there", isFinal: true, timestamp: 444 };

  it("builds a speech entry for a final, supported, non-empty caption", () => {
    expect(speechConversationEntry(base, "en-IN")).toEqual({
      text: "Hello there",
      source: "speech",
      language: "en-IN",
      timestamp: 444,
    });
  });

  it("returns null for an interim (not yet final) result", () => {
    expect(speechConversationEntry({ ...base, isFinal: false }, "en-IN")).toBeNull();
  });

  it("returns null when the language is marked unsupported", () => {
    expect(speechConversationEntry({ ...base, unsupported: true }, "en-IN")).toBeNull();
  });

  it("returns null for empty/whitespace-only text", () => {
    expect(speechConversationEntry({ ...base, text: "   " }, "en-IN")).toBeNull();
  });
});

describe("appendConversationEntry (Phase 10.1 Part 4)", () => {
  it("appends to the end (oldest-first order preserved)", () => {
    const first: ConversationEntry = { text: "a", source: "gesture", language: "en-IN", timestamp: 1 };
    const second: ConversationEntry = { text: "b", source: "speech", language: "en-IN", timestamp: 2 };
    expect(appendConversationEntry([first], second, 10)).toEqual([first, second]);
  });

  it("trims to the most recent maxLength entries", () => {
    const history: ConversationEntry[] = Array.from({ length: 6 }, (_, i) => ({
      text: `${i}`,
      source: "gesture",
      language: "en-IN",
      timestamp: i,
    }));
    const newest: ConversationEntry = { text: "6", source: "gesture", language: "en-IN", timestamp: 6 };
    const result = appendConversationEntry(history, newest, 6);
    expect(result).toHaveLength(6);
    expect(result.map((e) => e.text)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});
