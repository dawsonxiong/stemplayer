import { useCallback } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { EFFECTS } from "~/lib/constants";

interface EffectsPanelProps {
  audioEngine: AudioEngine | null;
}

export function EffectsPanel({ audioEngine }: EffectsPanelProps) {
  const effectsMode = usePlayerStore((s) => s.effectsMode);
  const echo = usePlayerStore((s) => s.echo);
  const setEcho = usePlayerStore((s) => s.setEcho);
  const status = usePlayerStore((s) => s.status);

  const toggleEffects = useCallback(() => {
    const store = usePlayerStore.getState();
    const effects = audioEngine?.effects;
    if (!effects) return;

    if (store.effectsMode) {
      effects.bypass();
      store.toggleEffectsMode();
    } else {
      effects.engage();
      store.toggleEffectsMode();
    }
  }, [audioEngine]);

  const handleEchoTime = useCallback(
    (value: number) => {
      setEcho({ delayTime: value });
      audioEngine?.effects?.setEchoTime(value);
    },
    [audioEngine, setEcho]
  );

  const handleFeedback = useCallback(
    (value: number) => {
      setEcho({ feedback: value });
      audioEngine?.effects?.setFeedback(value);
    },
    [audioEngine, setEcho]
  );

  const handleWet = useCallback(
    (value: number) => {
      setEcho({ wet: value });
      audioEngine?.effects?.setWetDryMix(value);
    },
    [audioEngine, setEcho]
  );

  if (status !== "ready") return null;

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Toggle button */}
      <button
        onClick={toggleEffects}
        className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-medium uppercase tracking-wider transition-all active:scale-[0.97]"
        style={{
          backgroundColor: effectsMode
            ? "rgba(168,85,247,0.15)"
            : "var(--color-bg-secondary)",
          border: `1px solid ${effectsMode ? "rgba(168,85,247,0.3)" : "var(--color-border)"}`,
          color: effectsMode ? "#c084fc" : "var(--color-text-secondary)",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="5.5" cy="17.5" r="2.5" />
          <circle cx="17.5" cy="5.5" r="2.5" />
          <path d="M8 17.5h8a4 4 0 0 0 0-8H8a4 4 0 0 1 0-8h8" />
        </svg>
        {effectsMode ? "Effects On" : "Effects"}
      </button>

      {/* Effect sliders — only visible when engaged */}
      {effectsMode && (
        <div
          className="flex flex-col gap-3 rounded-xl p-3"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            border: "1px solid rgba(168,85,247,0.15)",
          }}
        >
          <EffectSlider
            label="Echo"
            value={echo.delayTime}
            min={EFFECTS.echo.min}
            max={EFFECTS.echo.max}
            onChange={handleEchoTime}
            color="#c084fc"
          />
          <EffectSlider
            label="Feedback"
            value={echo.feedback}
            min={EFFECTS.feedback.min}
            max={EFFECTS.feedback.max}
            onChange={handleFeedback}
            color="#a78bfa"
          />
          <EffectSlider
            label="Wet/Dry"
            value={echo.wet}
            min={0}
            max={1}
            onChange={handleWet}
            color="#818cf8"
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
  onChange,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  color: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </span>
      <div className="relative flex-1">
        <input
          type="range"
          min={min}
          max={max}
          step={(max - min) / 100}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="slider-input w-full"
          style={
            {
              "--slider-pct": `${pct}%`,
              "--slider-color": color,
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  );
}
