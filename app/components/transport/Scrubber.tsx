import { useCallback, useRef, useState } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { useAnimationFrame } from "~/hooks/useAnimationFrame";

interface ScrubberProps {
  audioEngine: AudioEngine | null;
}

export function Scrubber({ audioEngine }: ScrubberProps) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const trackRef = useRef<HTMLDivElement>(null);
  const [isSeeking, setIsSeeking] = useState(false);

  // Sync time from engine
  useAnimationFrame(
    useCallback(() => {
      if (!audioEngine || isSeeking) return;
      setCurrentTime(audioEngine.currentTime);
      setDuration(audioEngine.duration);
    }, [audioEngine, isSeeking, setCurrentTime, setDuration]),
    isPlaying
  );

  const seekFromPointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current || !audioEngine) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = ratio * audioEngine.duration;
      audioEngine.seek(time);
      setCurrentTime(time);
    },
    [audioEngine, setCurrentTime]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setIsSeeking(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      seekFromPointer(e.clientX);
    },
    [seekFromPointer]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isSeeking) return;
      seekFromPointer(e.clientX);
    },
    [isSeeking, seekFromPointer]
  );

  const handlePointerUp = useCallback(() => {
    setIsSeeking(false);
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={trackRef}
      className="relative h-1.5 flex-1 cursor-pointer rounded-full select-none"
      style={{
        backgroundColor: "rgba(255,255,255,0.08)",
        touchAction: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Progress fill */}
      <div
        className="absolute top-0 left-0 h-full rounded-full"
        style={{
          width: `${progress}%`,
          backgroundColor: "var(--color-text-primary)",
        }}
      />

      {/* Scrub handle */}
      <div
        className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
        style={{
          left: `calc(${progress}% - 6px)`,
          backgroundColor: "var(--color-text-primary)",
          boxShadow: "0 0 6px rgba(0,0,0,0.5)",
          opacity: isSeeking ? 1 : 0,
          transition: "opacity 150ms",
        }}
      />
    </div>
  );
}
