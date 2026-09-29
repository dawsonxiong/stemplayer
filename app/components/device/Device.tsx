import { useCallback, useState } from "react";
import { STEMS, type StemName } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";
import { useAnimationFrame } from "~/hooks/useAnimationFrame";
import type { AudioEngine } from "~/lib/audio/engine";
import { DeviceScene } from "./DeviceScene";
import { Slider } from "./Slider";

interface DeviceProps {
  audioEngine: AudioEngine | null;
}

const stemNames = Object.keys(STEMS) as StemName[];

export function Device({ audioEngine }: DeviceProps) {
  const status = usePlayerStore((s) => s.status);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volumes = usePlayerStore((s) => s.volumes);
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
    isPlaying && status === "ready",
  );

  const handleStemVolume = useCallback(
    (stem: StemName, value: number) => {
      usePlayerStore.getState().setVolume(stem, value);
      audioEngine?.setVolume(stem, value);
    },
    [audioEngine],
  );

  const handleTogglePlay = useCallback(() => {
    const store = usePlayerStore.getState();
    if (!audioEngine || store.status !== "ready" || !store.isOn) return;
    if (audioEngine.isPlaying) {
      audioEngine.pause();
      store.setPlaying(false);
    } else {
      audioEngine.play();
      store.setPlaying(true);
    }
  }, [audioEngine]);

  const handleVolumeStep = useCallback(
    (delta: number) => {
      const store = usePlayerStore.getState();
      const next = Math.min(1, Math.max(0, store.masterVolume + delta));
      store.setMasterVolume(next);
      audioEngine?.setMasterVolume(next);
    },
    [audioEngine],
  );

  const handleTogglePower = useCallback(() => {
    const store = usePlayerStore.getState();
    const next = !store.isOn;
    store.setPower(next);
    if (!next) {
      // Powering off silences and stops, like pulling the plug.
      audioEngine?.pause();
      store.setPlaying(false);
    }
  }, [audioEngine]);

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <DeviceScene
        volumes={volumes}
        amplitudes={amplitudes}
        onStemVolume={handleStemVolume}
        onTogglePlay={handleTogglePlay}
        onVolumeStep={handleVolumeStep}
        onTogglePower={handleTogglePower}
      />

      {status === "ready" && (
        <div role="group" aria-label="Stem levels" className="relative z-10 flex gap-7">
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
  );
}
