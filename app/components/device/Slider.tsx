import { useCallback, useRef } from "react";
import { useSliderDrag } from "~/hooks/useSliderDrag";
import type { AudioEngine } from "~/lib/audio/engine";
import { LED_PALETTE, STEMS, type StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";

interface SliderProps {
  stemName: StemName;
  audioEngine: AudioEngine | null;
  amplitude: number;
}

const LED_COUNT = LED_PALETTE.length;
const KEY_STEP = 1 / LED_COUNT;

/** A flat copy of one groove: five LEDs that fill from the hub outward, lit in
 *  the same cyan-to-magenta ramp. It is also the keyboard and screen reader
 *  route to the mix, which the 3D canvas cannot offer. */
export function Slider({ stemName, audioEngine, amplitude }: SliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const volume = usePlayerStore((s) => s.volumes[stemName]);
  const isOn = usePlayerStore((s) => s.isOn);
  const stem = STEMS[stemName];

  const { handlePointerDown, handlePointerMove, handlePointerUp } = useSliderDrag(
    stemName,
    audioEngine,
    sliderRef,
  );

  const setLevel = useCallback(
    (value: number) => {
      const v = Math.max(0, Math.min(1, value));
      usePlayerStore.getState().setVolume(stemName, v);
      audioEngine?.setVolume(stemName, v);
    },
    [stemName, audioEngine],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next: number | null = null;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = volume + KEY_STEP;
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = volume - KEY_STEP;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = 1;
      if (next === null) return;
      e.preventDefault();
      // Arrows also seek page-wide; here they belong to the slider.
      e.stopPropagation();
      setLevel(next);
    },
    [volume, setLevel],
  );

  // Off reads as empty, like the device's dark LEDs. The stored level is kept,
  // so powering back on restores the mix.
  const level = isOn ? volume : 0;
  // Same quantising as the shader: whole LEDs, never half-lit.
  const lit = Math.ceil(level * LED_COUNT - 0.0001);
  const glow = 0.55 + amplitude * 1.4;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={sliderRef}
        role="slider"
        tabIndex={isOn ? 0 : -1}
        aria-label={stem.label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
        aria-valuetext={`${Math.round(volume * 100)}%`}
        aria-disabled={!isOn}
        className="flex cursor-pointer flex-col-reverse items-center gap-1.5 rounded-full px-1.5 py-2 select-none"
        style={{
          backgroundColor: "var(--color-well)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.12)",
          touchAction: "none",
          pointerEvents: isOn ? "auto" : "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        {LED_PALETTE.map((colour, i) => {
          const on = i < lit;
          return (
            <span
              key={colour}
              aria-hidden="true"
              className="h-3 w-3 rounded-full"
              style={{
                backgroundColor: on ? colour : "rgba(0,0,0,0.06)",
                boxShadow: on
                  ? `0 0 ${Math.round(4 + glow * 5)}px ${colour}, inset 0 0 0 1px rgba(0,0,0,0.28)`
                  : "inset 0 1px 1px rgba(0,0,0,0.14)",
                // A visible fall when the power goes off.
                transition: isOn ? "none" : "background-color 300ms ease-out",
              }}
            />
          );
        })}
      </div>

      <span
        aria-hidden="true"
        className="text-[10px] font-medium tracking-[0.12em] uppercase"
        style={{
          color: level > 0.02 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        }}
      >
        {stem.label}
      </span>
    </div>
  );
}
