import { useCallback, useId } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { EFFECTS, EFFECT_NAMES, type EffectName } from "~/lib/constants";
import { syncEffects, toggleEffects } from "~/lib/effects";
import { Segmented } from "~/components/ui/Segmented";
import { SliderRow } from "~/components/ui/ControlRow";

interface EffectsPanelProps {
  audioEngine: AudioEngine | null;
}

const EFFECT_LABELS: Record<EffectName, string> = {
  echo: "Echo",
  reverb: "Reverb",
  filter: "Filter",
};

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function EffectsPanel({ audioEngine }: EffectsPanelProps) {
  const effectsMode = usePlayerStore((s) => s.effectsMode);
  const effect = usePlayerStore((s) => s.effect);
  const echo = usePlayerStore((s) => s.echo);
  const reverb = usePlayerStore((s) => s.reverb);
  const filter = usePlayerStore((s) => s.filter);
  const status = usePlayerStore((s) => s.status);
  const panelId = useId();

  // Every control writes to the store, then the audio catches up with it.
  const update = useCallback(
    (change: (store: ReturnType<typeof usePlayerStore.getState>) => void) => {
      change(usePlayerStore.getState());
      syncEffects(audioEngine);
    },
    [audioEngine],
  );

  if (status !== "ready") return null;

  return (
    <div className="panel-in flex w-full flex-col rounded-panel border border-line bg-raised">
      <button
        type="button"
        onClick={() => toggleEffects(audioEngine)}
        role="switch"
        aria-checked={effectsMode}
        aria-controls={panelId}
        className="flex items-center gap-2.5 rounded-panel px-4 py-2.5 text-body text-ink"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="5.5" cy="17.5" r="2.5" />
          <circle cx="17.5" cy="5.5" r="2.5" />
          <path d="M8 17.5h8a4 4 0 0 0 0-8H8a4 4 0 0 1 0-8h8" />
        </svg>
        Effects
        {/* A switch, not a disclosure: the controls show only while effects play. */}
        <span
          aria-hidden="true"
          className={`ml-auto flex h-[18px] w-8 items-center rounded-full p-0.5 transition-colors ${effectsMode ? "bg-ink" : "bg-well"}`}
        >
          <span
            className={`size-3.5 rounded-full bg-page transition-transform duration-200 ${effectsMode ? "translate-x-3.5" : ""}`}
          />
        </span>
      </button>

      {effectsMode && (
        <div id={panelId} className="flex flex-col gap-3 px-4 pt-1 pb-4">
          <Segmented
            label="Effect"
            options={EFFECT_NAMES}
            value={effect}
            format={(name) => EFFECT_LABELS[name]}
            onChange={(name) => update((s) => s.setEffect(name))}
          />

          {effect === "echo" && (
            <>
              <SliderRow
                label="Time"
                value={echo.delayTime}
                min={EFFECTS.echo.min}
                max={EFFECTS.echo.max}
                format={(v) => `${Math.round(v * 1000)} ms`}
                onChange={(v) => update((s) => s.setEcho({ delayTime: v }))}
              />
              <SliderRow
                label="Repeats"
                value={echo.feedback}
                min={EFFECTS.feedback.min}
                max={EFFECTS.feedback.max}
                format={(v) => percent(v / EFFECTS.feedback.max)}
                onChange={(v) => update((s) => s.setEcho({ feedback: v }))}
              />
              <SliderRow
                label="Mix"
                value={echo.wet}
                min={0}
                max={1}
                format={percent}
                onChange={(v) => update((s) => s.setEcho({ wet: v }))}
              />
            </>
          )}

          {effect === "reverb" && (
            <>
              <SliderRow
                label="Size"
                value={reverb.size}
                min={EFFECTS.reverbSize.min}
                max={EFFECTS.reverbSize.max}
                format={(v) => `${v.toFixed(1)} s`}
                onChange={(v) => update((s) => s.setReverb({ size: v }))}
              />
              <SliderRow
                label="Mix"
                value={reverb.wet}
                min={0}
                max={1}
                format={percent}
                onChange={(v) => update((s) => s.setReverb({ wet: v }))}
              />
            </>
          )}

          {effect === "filter" && (
            <>
              <SliderRow
                label="Cutoff"
                value={filter.cutoff}
                min={0}
                max={1}
                format={(v) => formatHz(200 * Math.pow(100, v))}
                onChange={(v) => update((s) => s.setFilter({ cutoff: v }))}
              />
              <SliderRow
                label="Resonance"
                value={filter.resonance}
                min={EFFECTS.resonance.min}
                max={EFFECTS.resonance.max}
                format={(v) =>
                  percent(
                    (v - EFFECTS.resonance.min) / (EFFECTS.resonance.max - EFFECTS.resonance.min),
                  )
                }
                onChange={(v) => update((s) => s.setFilter({ resonance: v }))}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatHz(hz: number) {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
}
