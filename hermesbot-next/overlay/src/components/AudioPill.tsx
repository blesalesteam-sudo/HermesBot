// OpenBot: one look for every audio in the chat (a voice note or an attached audio file): a pill with play, speed,
// a quiet waveform that fills as it plays, and the time. The audio element itself stays with the caller.
import { useMemo, type ReactNode } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";

const BARS = 44;
export const AUDIO_RATES = [1, 1.5, 2] as const;

export function nextAudioRate(rate: number): number {
  const index = AUDIO_RATES.indexOf(rate as (typeof AUDIO_RATES)[number]);
  return AUDIO_RATES[(index + 1) % AUDIO_RATES.length]!;
}

export function audioClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Bar heights drawn from the name, so the same audio always shows the same shape. */
function waveform(seed: string): number[] {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  return Array.from({ length: BARS }, (_, index) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const noise = ((state >>> 0) % 1000) / 1000;
    const envelope = 0.4 + 0.6 * Math.sin((Math.PI * (index + 0.5)) / BARS);
    return Math.max(0.16, noise * envelope);
  });
}

export function AudioPill({ seed, playing, loading = false, disabled = false, time, duration, rate, labels, onToggle, onSeek, onRate, trailing, className }: {
  seed: string;
  playing: boolean;
  loading?: boolean;
  disabled?: boolean;
  time: number;
  duration: number | null;
  rate: number;
  labels: { play: string; pause: string; speed: string };
  onToggle(): void;
  onSeek?(seconds: number): void;
  onRate(): void;
  trailing?: ReactNode;
  className?: string;
}) {
  const bars = useMemo(() => waveform(seed), [seed]);
  const played = duration ? Math.min(1, time / duration) : 0;
  return (
    <div data-audio-pill className={cn("inline-flex h-11 max-w-full items-center gap-3 rounded-full bg-card ps-1.5 pe-4 text-ink", className)}>
      <span className="flex h-8 shrink-0 items-center rounded-full bg-ink/[0.07]">
        <button type="button" onClick={onToggle} disabled={disabled || loading} aria-label={playing ? labels.pause : labels.play} title={playing ? labels.pause : labels.play}
          className="flex size-8 items-center justify-center rounded-full text-ink transition-colors enabled:hover:bg-ink/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : playing ? <Pause size={13} className="fill-current" /> : <Play size={13} className="translate-x-px fill-current" />}
        </button>
        <button type="button" onClick={onRate} aria-label={labels.speed} title={labels.speed}
          className="h-8 rounded-full pe-3 ps-0.5 text-[13px] tabular-nums text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {String(rate).replace(".", ",")}×
        </button>
      </span>
      <span aria-hidden="true" data-audio-wave
        onClick={(event) => {
          if (!onSeek || !duration) return;
          const box = event.currentTarget.getBoundingClientRect();
          onSeek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration);
        }}
        className={cn("flex h-6 w-[210px] min-w-0 shrink items-center gap-[2px]", onSeek && duration ? "cursor-pointer" : "")}>
        {bars.map((height, index) => (
          <span key={index} style={{ height: `${Math.round(height * 100)}%` }}
            className={cn("min-w-0 flex-1 rounded-full", (index + 0.5) / BARS <= played ? "bg-ink/70" : "bg-ink/[0.22]")} />
        ))}
      </span>
      <span className="shrink-0 text-[13px] tabular-nums text-ink-secondary">{audioClock(playing || time > 0 ? time : duration ?? 0)}</span>
      {trailing}
    </div>
  );
}
