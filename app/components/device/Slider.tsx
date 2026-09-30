import { useCallback, useRef } from "react";
import { useSliderDrag } from "~/hooks/useSliderDrag";
import type { AudioEngine } from "~/lib/audio/engine";
import { LED_PALETTE, STEMS, type StemName } from "~/lib/constants";
import { toggleIsolated } from "~/lib/mix";
import { usePlayerStore } from "~/lib/store";

interface SliderProps {
  stemName: StemName;
  audioEngine: AudioEngine | null;
}

const LED_COUNT = LED_PALETTE.length;
const KEY_STEP = 1 / LED_COUNT;

/** A flat copy of one groove: five LEDs that fill from the hub outward, lit in
 *  the same cyan-to-magenta ramp. It is also the keyboard and screen reader
 *  route to the mix, which the 3D canvas cannot offer. */
export function Slider({ stemName, audioEngine }: SliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const volume = usePlayerStore((s) => s.volumes[stemName]);
  const isOn = usePlayerStore((s) => s.isOn);
  const isolated = usePlayerStore((s) => s.isolated);
  const stem = STEMS[stemName];
  const isIsolated = isolated.includes(stemName);
  // Another stem is playing on its own, so this one is silent for now.
  const silenced = isolated.length > 0 && !isIsolated;

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

  // Off or silenced reads as empty, like the device's dark LEDs. The stored
  // level is kept, so powering on or clearing isolation restores the mix.
  const level = isOn && !silenced ? volume : 0;
  // Same quantising as the shader: whole LEDs, never half-lit.
  const lit = Math.ceil(level * LED_COUNT - 0.0001);

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
        aria-valuetext={`${Math.round(volume * 100)}%${silenced ? ", silent while another stem plays alone" : ""}`}
        aria-disabled={!isOn}
        className="flex cursor-pointer flex-col-reverse items-center gap-1.5 rounded-full bg-well px-1.5 py-2 select-none"
        style={{
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
                backgroundColor: on ? colour : "var(--color-well)",
                // A visible fall when the power goes off.
                transition: isOn ? "none" : "background-color 300ms ease-out",
              }}
            />
          );
        })}
      </div>

      {/* Tap to play this stem on its own, as holding a groove's rim does on
          the device. Several can play alone together. */}
      <button
        type="button"
        onClick={() => toggleIsolated(audioEngine, stemName)}
        disabled={!isOn}
        aria-pressed={isIsolated}
        aria-label={`Isolate ${stem.label.toLowerCase()}`}
        title={`Isolate ${stem.label.toLowerCase()}`}
        className={`rounded-full px-2 py-0.5 text-micro uppercase transition-colors ${
          isIsolated
            ? "bg-cyan-ink text-page"
            : level > 0.02
              ? "text-ink hover:bg-well"
              : "text-ink-muted hover:bg-well"
        }`}
      >
        {stem.label}
      </button>
    </div>
  );
}
