import { useCallback, useRef, useState } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { useAnimationFrame } from "~/hooks/useAnimationFrame";
import { formatTime } from "~/lib/utils/format";

interface ScrubberProps {
  audioEngine: AudioEngine | null;
}

const KEY_STEP_SECONDS = 5;

export function Scrubber({ audioEngine }: ScrubberProps) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const loop = usePlayerStore((s) => s.loop);
  // While it's still separating: how much has arrived, and whether it's
  // waiting for more.
  const live = usePlayerStore((s) => s.live);
  const liveLoaded = usePlayerStore((s) => s.liveLoaded);
  const buffering = usePlayerStore((s) => s.buffering);
  const setLiveLoaded = usePlayerStore((s) => s.setLiveLoaded);

  const trackRef = useRef<HTMLDivElement>(null);
  const [isSeeking, setIsSeeking] = useState(false);

  // Sync time from engine
  useAnimationFrame(
    useCallback(() => {
      if (!audioEngine) return;
      if (live) setLiveLoaded(audioEngine.loaded);
      if (isSeeking) return;
      setCurrentTime(audioEngine.currentTime);
      setDuration(audioEngine.duration);
    }, [audioEngine, isSeeking, live, setCurrentTime, setDuration, setLiveLoaded]),
    isPlaying || live,
  );

  const seekTo = useCallback(
    (time: number) => {
      if (!audioEngine) return;
      const clamped = Math.max(0, Math.min(audioEngine.duration, time));
      audioEngine.seek(clamped);
      setCurrentTime(clamped);
    },
    [audioEngine, setCurrentTime],
  );

  const seekFromPointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current || !audioEngine) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekTo(ratio * audioEngine.duration);
    },
    [audioEngine, seekTo],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setIsSeeking(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekFromPointer(e.clientX);
    },
    [seekFromPointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isSeeking) return;
      seekFromPointer(e.clientX);
    },
    [isSeeking, seekFromPointer],
  );

  const handlePointerUp = useCallback(() => {
    setIsSeeking(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step =
        e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -KEY_STEP_SECONDS
          : e.key === "ArrowRight" || e.key === "ArrowUp"
            ? KEY_STEP_SECONDS
            : null;
      let target: number | null = step === null ? null : currentTime + step;
      if (e.key === "Home") target = 0;
      if (e.key === "End") target = duration;
      if (target === null) return;
      e.preventDefault();
      // The page-wide arrow shortcut would seek a second time.
      e.stopPropagation();
      seekTo(target);
    },
    [currentTime, duration, seekTo],
  );

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const progress = pct(currentTime);

  return (
    // The visible track is 6px; the hit area around it is a comfortable 24px.
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}${buffering ? ", buffering" : ""}`}
      aria-busy={buffering}
      className="group relative flex h-6 flex-1 cursor-pointer items-center rounded-full select-none"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className="relative h-1.5 w-full rounded-full bg-well">
        {/* What's arrived so far, while the song is still being separated */}
        {live && (
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-line-strong"
            style={{ width: `${Math.min(100, pct(liveLoaded))}%` }}
          />
        )}

        {/* Loop region, or just its in point while the out point is pending */}
        {loop.start !== null && (
          <div
            className="absolute -top-1 -bottom-1 rounded-key bg-cyan-ink/30"
            style={{
              left: `${pct(loop.start)}%`,
              width: loop.end !== null ? `${pct(loop.end - loop.start)}%` : "2px",
            }}
          />
        )}

        {/* Pulses while it waits for more of the song */}
        <div
          className={`absolute top-0 left-0 h-full rounded-full bg-ink ${buffering ? "animate-pulse" : ""}`}
          style={{ width: `${progress}%` }}
        />

        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{
            left: `calc(${progress}% - 6px)`,
            opacity: isSeeking ? 1 : undefined,
          }}
        />
      </div>
    </div>
  );
}
