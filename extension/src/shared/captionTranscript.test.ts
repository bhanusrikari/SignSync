import { describe, expect, it } from "vitest";
import { accumulateTranscript } from "./captionTranscript";
import type { CaptionResultLike } from "./captionTranscript";

describe("accumulateTranscript", () => {
  it("returns interim text as combinedText without finalizing it", () => {
    const results: CaptionResultLike[] = [{ isFinal: false, transcript: "hello" }];
    const update = accumulateTranscript("", -1, results, 0);

    expect(update.combinedText).toBe("hello");
    expect(update.isFinal).toBe(false);
    expect(update.finalTranscript).toBe("");
    expect(update.lastFinalizedIndex).toBe(-1);
  });

  it("folds a final result into finalTranscript and marks isFinal", () => {
    const results: CaptionResultLike[] = [{ isFinal: true, transcript: "hello world" }];
    const update = accumulateTranscript("", -1, results, 0);

    expect(update.combinedText).toBe("hello world");
    expect(update.isFinal).toBe(true);
    expect(update.finalTranscript).toBe("hello world");
    expect(update.lastFinalizedIndex).toBe(0);
  });

  it("preserves a previously finalized sentence when a new segment starts interim", () => {
    // First segment already finalized (e.g. from an earlier onresult event).
    const first = accumulateTranscript("", -1, [{ isFinal: true, transcript: "hello world." }], 0);

    // A brand-new result index begins for the next clause, still interim.
    const results: CaptionResultLike[] = [
      { isFinal: true, transcript: "hello world." },
      { isFinal: false, transcript: "how are" },
    ];
    const second = accumulateTranscript(first.finalTranscript, first.lastFinalizedIndex, results, 1);

    expect(second.combinedText).toBe("hello world. how are");
    expect(second.isFinal).toBe(false);
    expect(second.finalTranscript).toBe("hello world.");
  });

  it("accumulates a long multi-segment sentence across several final results", () => {
    // event.results always holds the FULL growing list (not just the newest
    // segment); event.resultIndex ("startIndex" here) is where each event
    // says the change begins.
    const segments: CaptionResultLike[] = [
      { isFinal: true, transcript: "this is a very long sentence" },
      { isFinal: true, transcript: "that keeps going for a while" },
      { isFinal: true, transcript: "and finally comes to an end" },
    ];

    let finalTranscript = "";
    let lastFinalizedIndex = -1;

    for (let i = 0; i < segments.length; i++) {
      const update = accumulateTranscript(finalTranscript, lastFinalizedIndex, segments.slice(0, i + 1), i);
      finalTranscript = update.finalTranscript;
      lastFinalizedIndex = update.lastFinalizedIndex;
    }

    expect(finalTranscript).toBe(
      "this is a very long sentence that keeps going for a while and finally comes to an end",
    );
  });

  it("does not duplicate a result already folded in when the same index repeats", () => {
    const results: CaptionResultLike[] = [{ isFinal: true, transcript: "hello world" }];
    const first = accumulateTranscript("", -1, results, 0);
    // Same event/index reprocessed (e.g. a duplicate dispatch).
    const second = accumulateTranscript(first.finalTranscript, first.lastFinalizedIndex, results, 0);

    expect(second.finalTranscript).toBe("hello world");
    expect(second.combinedText).toBe("hello world");
  });

  it("preserves the session transcript across a restart that resets lastFinalizedIndex but not finalTranscript", () => {
    // Simulates onend -> startRecognitionInstance(): a new SpeechRecognition
    // instance's own results restart at index 0, but finalTranscript (module
    // level in offscreen.ts) is carried over rather than reset.
    const carriedOverFinalTranscript = "hello world.";
    const freshInstanceResults: CaptionResultLike[] = [{ isFinal: true, transcript: "new sentence after restart" }];

    const update = accumulateTranscript(carriedOverFinalTranscript, -1, freshInstanceResults, 0);

    expect(update.finalTranscript).toBe("hello world. new sentence after restart");
    expect(update.combinedText).toBe("hello world. new sentence after restart");
  });

  it("ignores empty-transcript results without disturbing existing state", () => {
    const results: CaptionResultLike[] = [{ isFinal: true, transcript: "" }];
    const update = accumulateTranscript("hello", 0, results, 0);

    expect(update.finalTranscript).toBe("hello");
    expect(update.combinedText).toBe("hello");
  });
});
