/**
 * Device speech-to-text for onboarding braindump.
 * Uses the browser / Electron Chromium SpeechRecognition API — not a local LLM.
 */

type SpeechCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function onboardingSpeechSupported(): boolean {
  return Boolean(speechCtor());
}

export function startOnboardingDictation(onTranscript: (chunk: string) => void): (() => void) | null {
  const Ctor = speechCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    const text = last?.[0]?.transcript?.trim();
    if (text) onTranscript(text);
  };
  rec.onerror = () => undefined;
  rec.onend = () => undefined;
  rec.start();
  return () => {
    try {
      rec.stop();
    } catch {
      // already stopped
    }
  };
}
