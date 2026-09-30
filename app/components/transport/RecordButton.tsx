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

  const label = isRecording ? "Stop recording and save mix" : "Record mix";

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn-icon ${isRecording ? "border-record" : ""}`}
      aria-label={label}
      aria-pressed={isRecording}
      title={label}
    >
      {isRecording ? (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <rect x="2" y="2" width="10" height="10" rx="1.5" fill="var(--color-record)" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="var(--color-record)" />
        </svg>
      )}
    </button>
  );
}
