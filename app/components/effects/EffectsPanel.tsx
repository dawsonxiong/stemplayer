import { useCallback, useId } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { EFFECTS } from "~/lib/constants";
import { toggleEffects } from "~/lib/effects";

interface EffectsPanelProps {
  audioEngine: AudioEngine | null;
}

export function EffectsPanel({ audioEngine }: EffectsPanelProps) {
  const effectsMode = usePlayerStore((s) => s.effectsMode);
  const echo = usePlayerStore((s) => s.echo);
  const setEcho = usePlayerStore((s) => s.setEcho);
  const status = usePlayerStore((s) => s.status);
  const panelId = useId();

  const handleEchoTime = useCallback(
    (value: number) => {
      setEcho({ delayTime: value });
      audioEngine?.effects?.setEchoTime(value);
    },
    [audioEngine, setEcho],
  );

  const handleFeedback = useCallback(
    (value: number) => {
      setEcho({ feedback: value });
      audioEngine?.effects?.setFeedback(value);
    },
    [audioEngine, setEcho],
  );

  const handleWet = useCallback(
    (value: number) => {
      setEcho({ wet: value });
      audioEngine?.effects?.setWetDryMix(value);
    },
    [audioEngine, setEcho],
  );

  if (status !== "ready") return null;

  return (
    <div
      className="panel-in flex w-full flex-col rounded-xl"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        border: `1px solid ${effectsMode ? "var(--color-cyan-ink)" : "var(--color-border)"}`,
      }}
    >
      <button
        type="button"
        onClick={() => toggleEffects(audioEngine)}
        aria-pressed={effectsMode}
        aria-controls={panelId}
        className="flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-[var(--color-text-primary)]"
      >
        <span className="flex items-center gap-2.5">
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
          Echo
        </span>
        {/* A lit LED, not a word, says it is on — the same way the device does. */}
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: effectsMode ? "var(--color-led-cyan)" : "var(--color-well)",
            boxShadow: effectsMode
              ? "0 0 6px var(--color-led-cyan), inset 0 0 0 1px var(--color-cyan-ink)"
              : "inset 0 1px 1px rgba(0,0,0,0.15)",
          }}
        />
      </button>

      {effectsMode && (
        <div id={panelId} className="flex flex-col gap-3 px-4 pt-1 pb-4">
          <EffectSlider
            label="Time"
            value={echo.delayTime}
            min={EFFECTS.echo.min}
            max={EFFECTS.echo.max}
            format={(v) => `${Math.round(v * 1000)} ms`}
            onChange={handleEchoTime}
          />
          <EffectSlider
            label="Repeats"
            value={echo.feedback}
            min={EFFECTS.feedback.min}
            max={EFFECTS.feedback.max}
            format={(v) => `${Math.round((v / EFFECTS.feedback.max) * 100)}%`}
            onChange={handleFeedback}
          />
          <EffectSlider
            label="Mix"
            value={echo.wet}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={handleWet}
          />
        </div>
      )}
    </div>
  );
}

function EffectSlider({
  label,
  value,
  min,
  max,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3">
      <label htmlFor={id} className="text-xs text-[var(--color-text-secondary)]">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider-input w-full"
        style={
          {
            "--slider-pct": `${pct}%`,
            "--slider-color": "var(--color-cyan-ink)",
          } as React.CSSProperties
        }
      />
      <output
        htmlFor={id}
        className="text-right text-xs tabular-nums text-[var(--color-text-secondary)]"
      >
        {format(value)}
      </output>
    </div>
  );
}
