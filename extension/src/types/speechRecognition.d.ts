/**
 * Minimal ambient types for the Web Speech API's SpeechRecognition.
 *
 * TypeScript's bundled DOM lib already declares SpeechRecognitionResult /
 * SpeechRecognitionResultList / SpeechRecognitionAlternative (checked
 * directly in node_modules/typescript/lib/lib.dom.d.ts), but NOT the
 * SpeechRecognition constructor itself, its event types, or the
 * (vendor-prefixed) window properties. Hand-written here -- deliberately
 * not an @types package -- so only what this project actually uses is
 * declared, with zero new npm dependency.
 */

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((this: SpeechRecognition, event: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

interface Window {
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
