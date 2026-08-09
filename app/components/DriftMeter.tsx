import { useCallback, useRef, useState } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { useAnimationFrame } from "~/hooks/useAnimationFrame";

interface DriftMeterProps {
  audioEngine: AudioEngine | null;
}

/** Dev-only readout of how far the four stems have slid apart. Drives the
 *  call on whether to move off HTMLAudioElement playback. */
export function DriftMeter({ audioEngine }: DriftMeterProps) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const peak = useRef(0);
  const [reading, setReading] = useState({ now: 0, peak: 0 });

  useAnimationFrame(
    useCallback(() => {
      if (!audioEngine) return;
      const now = audioEngine.getDriftMs();
      if (now > peak.current) peak.current = now;
      setReading({ now, peak: peak.current });
    }, [audioEngine]),
    isPlaying
  );

  return (
    <div className="text-center text-[10px] tracking-[0.04em] text-[var(--color-text-muted)]">
      drift {reading.now.toFixed(1)}ms · peak {reading.peak.toFixed(1)}ms
    </div>
  );
}
