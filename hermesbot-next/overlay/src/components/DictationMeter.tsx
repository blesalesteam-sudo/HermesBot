// OpenBot: what the mic button shows while it records: a red dot, bars that follow the voice and the time so far, then a
// stop square. In the web app the bars read the real microphone level; in the desktop app (where the native side owns
// the mic) they sway on their own. With reduced motion they stand still. Used by src/components/Composer.tsx.
import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "@/lib/onboarding";

const BARS = 7;
const REST = 0.22;

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function DictationMeter() {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const draw = (levels: number[]) => levels.forEach((level, i) => {
      const bar = bars.current[i];
      if (bar) bar.style.transform = `scaleY(${Math.max(REST, Math.min(1, level))})`;
    });
    if (reducedMotion() || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      draw([0.4, 0.7, 0.5, 0.9, 0.55, 0.75, 0.45]);
      return;
    }

    let frame = 0;
    let closed = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    const smooth = new Array<number>(BARS).fill(REST);

    const loop = (now: number) => {
      if (closed) return;
      const target = new Array<number>(BARS);
      if (analyser && bins) {
        analyser.getByteFrequencyData(bins);
        // Speech lives in the lower bins; spread them over the bars, loudest in the middle.
        const span = Math.max(1, Math.floor((bins.length * 0.45) / BARS));
        for (let i = 0; i < BARS; i += 1) {
          let sum = 0;
          for (let j = 0; j < span; j += 1) sum += bins[i * span + j] ?? 0;
          const order = [3, 2, 4, 1, 5, 0, 6][i];
          target[order] = Math.pow(sum / span / 255, 0.8) * 1.6;
        }
      } else {
        for (let i = 0; i < BARS; i += 1) target[i] = 0.45 + 0.35 * Math.sin(now / 260 + i * 1.3) * Math.sin(now / 610 + i * 0.7);
      }
      for (let i = 0; i < BARS; i += 1) smooth[i] += (target[i] - smooth[i]) * (target[i] > smooth[i] ? 0.5 : 0.18);
      draw(smooth);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // The browser's recognizer already holds the mic, so this shares the same permission and asks nothing new.
    if (!window.ogb && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
        if (closed) return s.getTracks().forEach((track) => track.stop());
        stream = s;
        context = new AudioContext();
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        context.createMediaStreamSource(s).connect(analyser);
        bins = new Uint8Array(analyser.frequencyBinCount);
      }).catch(() => undefined);
    }

    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
    };
  }, []);

  return (
    <span data-dictation-meter className="flex h-8 items-center gap-2.5 rounded-full bg-raised ps-3 pe-1 text-ink">
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
      <span aria-hidden className="flex h-[18px] items-center gap-[3px]">
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} ref={(el) => { bars.current[i] = el; }}
            className="h-full w-[3px] rounded-full bg-current"
            style={{ transform: `scaleY(${REST})`, transition: "transform 60ms linear" }} />
        ))}
      </span>
      <span className="min-w-[2.1em] text-[13px] tabular-nums">{clock(seconds)}</span>
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink">
        <span className="size-2 rounded-[2px] bg-composer" />
      </span>
    </span>
  );
}
