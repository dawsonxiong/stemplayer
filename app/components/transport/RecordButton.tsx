import { useCallback } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { MixRecorder } from "~/lib/audio/recorder";
import { usePlayerStore } from "~/lib/store";

interface RecordButtonProps {
  audioEngine: AudioEngine | null;
}

export function RecordButton({ audioEngine }: RecordButtonProps) {
  const isRecording = usePlayerStore((s) => s.isRecording);
  const setRecording = usePlayerStore((s) => s.setRecording);
  const trackTitle = usePlayerStore((s) => s.trackTitle);

  const toggle = useCallback(async () => {
    const recorder = audioEngine?.recorder;
    if (!recorder) return;

    if (isRecording) {
      const blob = await recorder.stop();
      setRecording(false);
      MixRecorder.download(blob, `${trackTitle || "mix"}-stem-mix.webm`);
    } else {
      recorder.start();
      setRecording(true);
    }
  }, [audioEngine, isRecording, setRecording, trackTitle]);

  return (
    <button
      onClick={toggle}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
      style={{
        backgroundColor: isRecording
          ? "rgba(239,68,68,0.15)"
          : "var(--color-bg-secondary)",
        border: `1px solid ${isRecording ? "rgba(239,68,68,0.3)" : "var(--color-border)"}`,
      }}
      aria-label={isRecording ? "Stop recording" : "Record mix"}
    >
      {isRecording ? (
        // Stop icon (square)
        <svg width="14" height="14" viewBox="0 0 14 14" fill="#ef4444">
          <rect x="2" y="2" width="10" height="10" rx="1.5" />
        </svg>
      ) : (
        // Record icon (circle)
        <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--color-text-secondary)">
          <circle cx="7" cy="7" r="5" />
        </svg>
      )}
    </button>
  );
}
