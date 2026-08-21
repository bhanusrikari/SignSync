/**
 * Pure accumulation logic for live-captions transcripts (see offscreen.ts).
 * Extracted so it can be unit tested without SpeechRecognition/DOM -- the
 * Web Speech API's onresult event only ever describes the result range
 * that changed (event.resultIndex onward), not the full session
 * transcript, so earlier finalized results must be folded in by hand or
 * they're lost the moment a new result index starts. That was the root
 * cause of long sentences appearing truncated to their last segment.
 */

export interface CaptionResultLike {
  isFinal: boolean;
  transcript: string;
}

export interface TranscriptUpdate {
  /** Finalized transcript so far, including this update's newly-final text. */
  finalTranscript: string;
  /** Highest result index already folded into finalTranscript -- scoped to
   *  ONE SpeechRecognition instance (its result indices restart at 0 on
   *  every new instance), unlike finalTranscript itself which spans the
   *  whole captions session across automatic onend restarts. */
  lastFinalizedIndex: number;
  /** finalTranscript plus any still-in-progress interim text, ready to
   *  display as-is. */
  combinedText: string;
  /** True only when there is no pending interim chunk, i.e. the caption is
   *  fully settled and not still being refined. */
  isFinal: boolean;
}

/**
 * Folds one SpeechRecognition `onresult` event's results (from
 * `startIndex` = `event.resultIndex` onward) into the running transcript.
 * Already-finalized results (index <= lastFinalizedIndex) are skipped so
 * repeated/overlapping result indexes never duplicate words.
 */
export function accumulateTranscript(
  finalTranscriptSoFar: string,
  lastFinalizedIndex: number,
  results: readonly CaptionResultLike[],
  startIndex: number,
): TranscriptUpdate {
  let finalTranscript = finalTranscriptSoFar;
  let newLastFinalizedIndex = lastFinalizedIndex;
  let interimTranscript = "";

  for (let i = startIndex; i < results.length; i++) {
    const text = results[i]?.transcript;
    if (!text) continue;
    if (results[i].isFinal) {
      if (i > newLastFinalizedIndex) {
        finalTranscript = finalTranscript ? `${finalTranscript} ${text}` : text;
        newLastFinalizedIndex = i;
      }
    } else {
      interimTranscript = text;
    }
  }

  const combinedText = interimTranscript ? `${finalTranscript} ${interimTranscript}`.trim() : finalTranscript;

  return {
    finalTranscript,
    lastFinalizedIndex: newLastFinalizedIndex,
    combinedText,
    isFinal: interimTranscript.length === 0,
  };
}
