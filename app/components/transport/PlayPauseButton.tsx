import { useCallback } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";

interface PlayPauseButtonProps {
  audioEngine: AudioEngine | null;
}

export function PlayPauseButton({ audioEngine }: PlayPauseButtonProps) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const isOn = usePlayerStore((s) => s.isOn);

  const toggle = useCallback(() => {
    if (!audioEngine || !isOn) return;
    if (isPlaying) {
      audioEngine.pause();
      setPlaying(false);
    } else {
      audioEngine.play();
      setPlaying(true);
    }
  }, [audioEngine, isPlaying, isOn, setPlaying]);

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!isOn}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        backgroundColor: "var(--color-bg-primary)",
        border: "1px solid var(--color-border)",
      }}
      aria-label={isPlaying ? "Pause" : "Play"}
    >
      {isPlaying ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="var(--color-text-primary)"
          aria-hidden="true"
        >
          <rect x="3" y="2" width="4" height="12" rx="1" />
          <rect x="9" y="2" width="4" height="12" rx="1" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="var(--color-text-primary)"
          aria-hidden="true"
        >
          <path d="M4 2.5v11l10-5.5z" />
        </svg>
      )}
    </button>
  );
}
