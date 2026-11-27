// OpenBot: dictation in the web app through the browser's own speech recognizer (Chrome, Edge and Safari), so the mic
// works without a paid voice key. Wired in through src/lib/speech.ts.
import type { SpeechBridge } from "./fish-speech";
import { activeLocale, intlLocale, t } from "./i18n";

type Line = Parameters<Parameters<SpeechBridge["onSpeechTranscript"]>[0]>[0];
type End = Parameters<Parameters<SpeechBridge["onSpeechEnd"]>[0]>[0];

interface RecognitionResult { readonly isFinal: boolean; readonly 0: { readonly transcript: string } }
interface RecognitionEvent { readonly results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognizer(): RecognitionCtor | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** The browser can turn speech into text on its own. */
export function browserSpeechSupported(): boolean {
  return typeof window !== "undefined" && !window.ogb && Boolean(recognizer());
}

const transcriptListeners = new Set<(line: Line) => void>();
const endListeners = new Set<(info: End) => void>();
const emitTranscript = (line: Line) => Array.from(transcriptListeners).forEach((fn) => fn(line));
const emitEnd = (info: End) => Array.from(endListeners).forEach((fn) => fn(info));

let current: Recognition | null = null;

function failure(error: string): End {
  if (error === "not-allowed" || error === "service-not-allowed") return { code: 1, reason: "microphone-blocked", message: t("call.live.micBlocked") };
  if (error === "audio-capture") return { code: 1, reason: "microphone-missing", message: t("call.live.micMissing") };
  return { code: 1, reason: "dictation-failed" };
}

function language(): string {
  // The app's language, with the browser's region when they agree ("es" + "es-ES" → "es-ES").
  const locale = activeLocale();
  const system = intlLocale();
  if (!locale) return system;
  return system.toLowerCase().startsWith(locale.toLowerCase().split("-")[0]) && !locale.includes("-") ? system : locale;
}

export const browserSpeech: SpeechBridge = {
  async speechStart(options) {
    current?.abort();
    const Ctor = recognizer();
    if (!Ctor) return emitEnd({ code: 2, reason: "unsupported" });
    const rec = new Ctor();
    current = rec;
    rec.lang = language();
    // A call ends the person's turn on a pause; the composer keeps listening until the mic is pressed again.
    rec.continuous = options?.endpointMs === undefined;
    rec.interimResults = true;
    let failed: End | null = null;
    rec.onresult = (event) => {
      if (current !== rec) return;
      let text = "";
      let final = true;
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        text += result[0].transcript;
        if (!result.isFinal) final = false;
      }
      text = text.replace(/\s+/g, " ").trim();
      if (text) emitTranscript({ partial: !final, text });
    };
    rec.onerror = (event) => {
      if (current !== rec || event.error === "aborted" || event.error === "no-speech") return;
      failed = failure(event.error);
    };
    rec.onend = () => {
      if (current !== rec) return;
      current = null;
      emitEnd(failed ?? { code: 0, reason: "completed" });
    };
    try {
      rec.start();
    } catch {
      current = null;
      emitEnd({ code: 1, reason: "dictation-failed" });
    }
  },
  async speechStop() {
    const rec = current;
    current = null;
    rec?.abort();
  },
  async speechFinish() {
    current?.stop();
  },
  onSpeechTranscript(cb) {
    transcriptListeners.add(cb);
    return () => transcriptListeners.delete(cb);
  },
  onSpeechEnd(cb) {
    endListeners.add(cb);
    return () => endListeners.delete(cb);
  },
};
