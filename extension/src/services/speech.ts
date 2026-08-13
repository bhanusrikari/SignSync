/**
 * Thin wrapper around the browser's native Web Speech API
 * (window.speechSynthesis). Knows nothing about gestures, MediaPipe,
 * cameras, or any SignSync-specific concept -- just "speak this text" and
 * "stop speaking". Runs in the content script's window context (a real
 * page window, unlike the background service worker which has no
 * speechSynthesis at all).
 */

function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Cancels any currently speaking/queued utterance, then speaks `text`.
 * Cancelling first (rather than letting utterances queue) means rapid
 * gesture changes replace speech instead of stacking it up into a backlog.
 *
 * Never throws -- a speech failure must not affect gesture recognition or
 * the overlay, so failures are logged and swallowed.
 */
export function speakText(text: string, lang?: string): void {
  // TEMPORARY diagnostics for the "no audible speech" investigation --
  // remove once root-caused.
  console.log("[SignSync DEBUG] speakText() called", { text, lang, supported: isSpeechSynthesisSupported() });

  if (!isSpeechSynthesisSupported()) {
    console.warn("[SignSync] speechSynthesis is not available in this context");
    return;
  }
  try {
    const voices = window.speechSynthesis.getVoices();
    console.log(
      "[SignSync DEBUG] getVoices() ->",
      voices.length,
      "total; matching lang:",
      lang ? voices.filter((v) => v.lang === lang).map((v) => v.name) : "(no lang requested)",
    );

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (lang) utterance.lang = lang;
    utterance.onstart = () => console.log("[SignSync DEBUG] utterance onstart:", text);
    utterance.onend = () => console.log("[SignSync DEBUG] utterance onend:", text);
    utterance.onerror = (event) => {
      console.warn("[SignSync] speechSynthesis utterance error:", event.error);
    };
    window.speechSynthesis.speak(utterance);
    console.log(
      "[SignSync DEBUG] speak() called; speechSynthesis.speaking=",
      window.speechSynthesis.speaking,
      "pending=",
      window.speechSynthesis.pending,
    );
  } catch (error) {
    console.warn("[SignSync] speakText failed:", error);
  }
}

/** Stops any currently speaking/queued utterance immediately. Safe to call
 *  even if nothing is speaking. */
export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (error) {
    console.warn("[SignSync] stopSpeaking failed:", error);
  }
}
