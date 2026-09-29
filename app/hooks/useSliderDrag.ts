import { useCallback, useRef } from "react";
import { usePlayerStore } from "~/lib/store";
import type { AudioEngine } from "~/lib/audio/engine";
import type { StemName } from "~/lib/constants";

export function useSliderDrag(
  stemName: StemName,
  audioEngine: AudioEngine | null,
  sliderRef: React.RefObject<HTMLDivElement | null>,
) {
  const isDragging = useRef(false);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const updateVolume = useCallback(
    (clientY: number) => {
      if (!sliderRef.current) return;
      const rect = sliderRef.current.getBoundingClientRect();
      const raw = 1 - (clientY - rect.top) / rect.height;
      const value = Math.max(0, Math.min(1, raw));

      setVolume(stemName, value);
      audioEngine?.setVolume(stemName, value);

      if ("vibrate" in navigator) {
        navigator.vibrate(3);
      }
    },
    [stemName, audioEngine, setVolume, sliderRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updateVolume(e.clientY);
    },
    [updateVolume],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      updateVolume(e.clientY);
    },
    [updateVolume],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return { handlePointerDown, handlePointerMove, handlePointerUp };
}
