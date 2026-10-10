import { useEffect, useRef, useState } from "react";
import { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";

export function useAudioEngine() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [engine, setEngine] = useState<AudioEngine | null>(null);

  useEffect(() => {
    const e = new AudioEngine();
    e.onEnded = () => usePlayerStore.getState().setPlaying(false);
    e.onBuffering = (buffering) => usePlayerStore.getState().setBuffering(buffering);
    engineRef.current = e;
    setEngine(e);

    return () => {
      e.dispose();
      engineRef.current = null;
    };
  }, []);

  return engine;
}
