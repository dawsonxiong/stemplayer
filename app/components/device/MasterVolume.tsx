import { useCallback } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { SliderRow } from "~/components/ui/ControlRow";

interface MasterVolumeProps {
  audioEngine: AudioEngine | null;
}

/** Output level. The device's side rocker steps it too. */
export function MasterVolume({ audioEngine }: MasterVolumeProps) {
  const masterVolume = usePlayerStore((s) => s.masterVolume);

  const handleChange = useCallback(
    (value: number) => {
      usePlayerStore.getState().setMasterVolume(value);
      audioEngine?.setMasterVolume(value);
    },
    [audioEngine],
  );

  return (
    <SliderRow
      label="Volume"
      value={masterVolume}
      min={0}
      max={1}
      format={(v) => `${Math.round(v * 100)}%`}
      onChange={handleChange}
    />
  );
}
