import type { AudioEngine } from "~/lib/audio/engine";
import { SPEEDS } from "~/lib/constants";
import { setSpeed } from "~/lib/mix";
import { usePlayerStore } from "~/lib/store";
import { ControlRow } from "~/components/ui/ControlRow";
import { Segmented } from "~/components/ui/Segmented";

/** Playback rate. Pitch moves with it, like a turntable. */
export function SpeedControl({ audioEngine }: { audioEngine: AudioEngine | null }) {
  const speed = usePlayerStore((s) => s.speed);

  return (
    <ControlRow label="Speed">
      <Segmented
        label="Speed"
        options={SPEEDS}
        value={speed as (typeof SPEEDS)[number]}
        format={(v) => `${v}×`}
        onChange={(v) => setSpeed(audioEngine, v)}
      />
    </ControlRow>
  );
}
