import { useRef } from "react";
import { useSliderDrag } from "~/hooks/useSliderDrag";
import type { AudioEngine } from "~/lib/audio/engine";
import { STEMS, type StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";

interface SliderProps {
  stemName: StemName;
  audioEngine: AudioEngine | null;
  amplitude: number;
}

export function Slider({ stemName, audioEngine, amplitude }: SliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const volume = usePlayerStore((s) => s.volumes[stemName]);
  const stem = STEMS[stemName];

  const { handlePointerDown, handlePointerMove, handlePointerUp } =
    useSliderDrag(stemName, audioEngine, sliderRef);

  const fillHeight = volume * 100;
  const glowIntensity = 8 + amplitude * 24;
  const brightness = 1 + amplitude * 0.4;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={sliderRef}
        className="relative w-3 cursor-pointer overflow-hidden rounded-full select-none"
        style={{
          height: "140px",
          backgroundColor: "rgba(0,0,0,0.4)",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* LED fill */}
        <div
          className="absolute bottom-0 left-0 w-full rounded-full transition-[height] duration-[16ms]"
          style={{
            height: `${fillHeight}%`,
            backgroundColor: stem.colour,
            filter: `brightness(${brightness})`,
            boxShadow: `0 0 ${glowIntensity}px ${stem.colour}, inset 0 0 ${glowIntensity / 2}px rgba(255,255,255,0.15)`,
          }}
        />

        {/* Slider knob indicator */}
        <div
          className="absolute left-1/2 h-1 w-5 -translate-x-1/2 rounded-full"
          style={{
            bottom: `calc(${fillHeight}% - 2px)`,
            backgroundColor: stem.colourLight,
            boxShadow: `0 0 6px ${stem.colour}`,
            opacity: volume > 0.02 ? 1 : 0,
          }}
        />
      </div>

      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: stem.colour }}
      >
        {stem.label}
      </span>
    </div>
  );
}
