import { useCallback, useId } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";

interface MasterVolumeProps {
  audioEngine: AudioEngine | null;
}

/** Output level. The device's side rocker steps it too. */
export function MasterVolume({ audioEngine }: MasterVolumeProps) {
  const masterVolume = usePlayerStore((s) => s.masterVolume);
  const id = useId();

  const handleChange = useCallback(
    (value: number) => {
      usePlayerStore.getState().setMasterVolume(value);
      audioEngine?.setMasterVolume(value);
    },
    [audioEngine],
  );

  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="text-xs text-[var(--color-text-secondary)]">
        Volume
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={masterVolume}
        aria-valuetext={`${Math.round(masterVolume * 100)}%`}
        onChange={(e) => handleChange(parseFloat(e.target.value))}
        className="slider-input w-24"
        style={
          {
            "--slider-pct": `${masterVolume * 100}%`,
            "--slider-color": "var(--color-text-primary)",
          } as React.CSSProperties
        }
      />
      <output
        htmlFor={id}
        className="w-7 text-right text-xs tabular-nums text-[var(--color-text-secondary)]"
      >
        {Math.round(masterVolume * 100)}
      </output>
    </div>
  );
}
