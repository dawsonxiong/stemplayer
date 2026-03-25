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

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={sliderRef}
        className="relative w-2 cursor-pointer overflow-hidden rounded-full select-none"
        style={{
          height: "90px",
          backgroundColor: "rgba(0,0,0,0.06)",
          touchAction: "none",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="absolute bottom-0 left-0 w-full rounded-full"
          style={{
            height: `${fillHeight}%`,
            backgroundColor: stem.colour,
            opacity: 0.7 + amplitude * 0.3,
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
