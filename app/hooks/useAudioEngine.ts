import { useEffect, useRef, useState } from "react";
import { AudioEngine } from "~/lib/audio/engine";

export function useAudioEngine() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [engine, setEngine] = useState<AudioEngine | null>(null);

  useEffect(() => {
    const e = new AudioEngine();
    engineRef.current = e;
    setEngine(e);

    return () => {
      e.dispose();
      engineRef.current = null;
    };
  }, []);

  return engine;
}
