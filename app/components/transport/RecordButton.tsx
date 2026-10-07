import { useCallback } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { MixRecorder } from "~/lib/audio/recorder";
import { usePlayerStore } from "~/lib/store";
import { formatTime } from "~/lib/utils/format";

interface RecordButtonProps {
  audioEngine: AudioEngine | null;
}

/** Records the mix as it plays. Pausing the song pauses the take too. */
export function RecordButton({ audioEngine }: RecordButtonProps) {
  const isRecording = usePlayerStore((s) => s.isRecording);
  const setRecording = usePlayerStore((s) => s.setRecording);
  const trackTitle = usePlayerStore((s) => s.trackTitle);
  const isOn = usePlayerStore((s) => s.isOn);
  // The take only grows while the song plays, so re-rendering on the playhead
  // is enough to keep the time below current.
  usePlayerStore((s) => (s.isRecording ? s.currentTime : 0));

  const toggle = useCallback(async () => {
    const recorder = audioEngine?.recorder;
    if (!audioEngine || !recorder) return;

    if (isRecording) {
      const blob = await recorder.stop();
      setRecording(false);
      MixRecorder.download(blob, `${trackTitle || "mix"}-stem-mix.webm`);
    } else {
      // Recording a paused song would capture silence, so record starts it.
      const store = usePlayerStore.getState();
      if (!store.isPlaying) {
        audioEngine.play();
        store.setPlaying(true);
      }
      recorder.start();
      setRecording(true);
    }
  }, [audioEngine, isRecording, setRecording, trackTitle]);

  const label = isRecording ? "Stop recording and save mix" : "Record mix";
  const elapsed = formatTime(audioEngine?.recorder?.elapsed ?? 0);

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!isOn && !isRecording}
      className={`btn-icon ${isRecording ? "w-auto gap-1.5 border-record px-3" : ""}`}
      // A steady name with a pressed state, plus the time shown on the button
      // so what's heard matches what's seen: "Record mix, 0:12, pressed".
      aria-label={isRecording ? `Record mix, ${elapsed}` : "Record mix"}
      aria-pressed={isRecording}
      title={label}
    >
      {isRecording ? (
        <>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="2" width="10" height="10" rx="1.5" fill="var(--color-record)" />
          </svg>
          <span className="text-caption tabular-nums text-ink">{elapsed}</span>
        </>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="var(--color-record)" />
        </svg>
      )}
    </button>
  );
}
