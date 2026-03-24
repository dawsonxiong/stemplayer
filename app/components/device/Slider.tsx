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
  const glowIntensity = 6 + amplitude * 20;
  const brightness = 1 + amplitude * 0.4;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={sliderRef}
        className="relative w-2.5 cursor-pointer overflow-hidden rounded-full select-none"
        style={{
          height: "100px",
          backgroundColor: "rgba(255,255,255,0.04)",
          touchAction: "none",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* LED fill */}
        <div
          className="absolute bottom-0 left-0 w-full rounded-full"
          style={{
            height: `${fillHeight}%`,
            backgroundColor: stem.colour,
            filter: `brightness(${brightness})`,
            boxShadow: `0 0 ${glowIntensity}px ${stem.colour}`,
            transition: "height 16ms linear",
          }}
        />
      </div>

      <span
        className="text-[9px] font-medium uppercase tracking-widest"
        style={{ color: volume > 0.02 ? stem.colour : "var(--color-text-muted)" }}
      >
        {stem.label}
      </span>
    </div>
  );
}
