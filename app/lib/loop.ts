import type { AudioEngine } from "./audio/engine";
import { usePlayerStore } from "./store";

const MIN_LOOP_SECONDS = 0.25;

/** One press sets the in point, the next sets the out point, the third clears. */
export function cycleLoop(audioEngine: AudioEngine | null) {
  if (!audioEngine) return;
  const { loop, setLoop } = usePlayerStore.getState();
  const now = audioEngine.currentTime;

  if (loop.start === null) {
    setLoop({ start: now, end: null });
  } else if (loop.end === null && now - loop.start >= MIN_LOOP_SECONDS) {
    setLoop({ end: now });
    audioEngine.setLoop(loop.start, now);
    audioEngine.seek(loop.start);
  } else {
    setLoop({ start: null, end: null });
    audioEngine.setLoop(null, null);
  }
}
