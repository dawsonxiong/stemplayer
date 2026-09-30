import type { AudioEngine } from "~/lib/audio/engine";
import { SPEEDS } from "~/lib/constants";
import { setSpeed } from "~/lib/mix";
import { usePlayerStore } from "~/lib/store";
import { Segmented } from "~/components/ui/Segmented";

/** Playback rate. Pitch moves with it, like a turntable. */
export function SpeedControl({ audioEngine }: { audioEngine: AudioEngine | null }) {
  const speed = usePlayerStore((s) => s.speed);

  return (
    <div className="flex items-center gap-3">
      <span className="text-caption text-ink-muted">Speed</span>
      <Segmented
        label="Speed"
        options={SPEEDS}
        value={speed as (typeof SPEEDS)[number]}
        format={(v) => `${v}×`}
        onChange={(v) => setSpeed(audioEngine, v)}
      />
    </div>
  );
}
