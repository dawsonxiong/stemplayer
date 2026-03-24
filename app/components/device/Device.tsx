import { useCallback } from "react";
import { STEMS, type StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";
import { useAnimationFrame } from "~/hooks/useAnimationFrame";
import type { AudioEngine } from "~/lib/audio/engine";
import { Slider } from "./Slider";
import { ProcessingAnimation } from "./ProcessingAnimation";
import { useState } from "react";

interface DeviceProps {
  audioEngine: AudioEngine | null;
}

const stemNames = Object.keys(STEMS) as StemName[];

export function Device({ audioEngine }: DeviceProps) {
  const status = usePlayerStore((s) => s.status);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const [amplitudes, setAmplitudes] = useState<Record<StemName, number>>({
    vocals: 0,
    drums: 0,
    bass: 0,
    other: 0,
  });

  // Update amplitudes from analyser data each frame
  useAnimationFrame(
    useCallback(() => {
      if (!audioEngine) return;
      const next: Record<string, number> = {};
      for (const name of stemNames) {
        const data = audioEngine.getAnalyserData(name);
        if (data.length === 0) {
          next[name] = 0;
          continue;
        }
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        next[name] = avg;
      }
      setAmplitudes(next as Record<StemName, number>);
    }, [audioEngine]),
    isPlaying && status === "ready"
  );

  const isProcessing = status === "processing";

  return (
    <div className="relative flex items-center justify-center">
      {/* Device body — the circular puck */}
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: "280px",
          height: "280px",
          background:
            "radial-gradient(ellipse at 40% 35%, #DDD0B8 0%, #D4C5A9 40%, #C4B494 100%)",
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -2px 4px rgba(0,0,0,0.1)",
        }}
      >
        {/* Subtle texture overlay */}
        <div
          className="absolute inset-0 rounded-full opacity-[0.03]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        {/* Edge ring */}
        <div
          className="absolute inset-1 rounded-full"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />

        {isProcessing ? (
          <ProcessingAnimation />
        ) : (
          /* Slider grooves */
          <div className="flex gap-5">
            {stemNames.map((name) => (
              <Slider
                key={name}
                stemName={name}
                audioEngine={audioEngine}
                amplitude={amplitudes[name]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
