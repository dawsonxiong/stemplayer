import { useEffect } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
import { cycleLoop } from "~/lib/loop";
import { toggleEffects } from "~/lib/effects";
import { usePlayerStore } from "~/lib/store";
import type { StemName } from "~/lib/constants";

const STEM_KEYS: Record<string, StemName> = {
  "1": "vocals",
  "2": "drums",
  "3": "bass",
  "4": "other",
};

export function useKeyboardShortcuts(audioEngine: AudioEngine | null) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Form controls own their keys; a focused button owns Space and Enter.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.target instanceof HTMLButtonElement && (e.code === "Space" || e.key === "Enter"))
        return;

      const store = usePlayerStore.getState();
      // Off means inert, like the hardware: no playback, mixing or seeking.
      if (store.status !== "ready" || !store.isOn) return;

      // Space — play/pause
      if (e.code === "Space") {
        e.preventDefault();
        if (audioEngine?.isPlaying) {
          audioEngine.pause();
          store.setPlaying(false);
        } else {
          audioEngine?.play();
          store.setPlaying(true);
        }
        return;
      }

      // 1-4 — solo/unsolo stems
      const stem = STEM_KEYS[e.key];
      if (stem) {
        e.preventDefault();
        const current = store.volumes[stem];
        // Toggle: if audible → mute, if muted → full
        const newVal = current > 0.05 ? 0 : 1;
        store.setVolume(stem, newVal);
        audioEngine?.setVolume(stem, newVal);
        return;
      }

      // E — toggle effects
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        toggleEffects(audioEngine);
        return;
      }

      // L — loop in / out / clear
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        cycleLoop(audioEngine);
        return;
      }

      // Left/Right arrow — seek
      if (audioEngine && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const step = e.key === "ArrowLeft" ? -5 : 5;
        const time = Math.max(0, Math.min(audioEngine.duration, audioEngine.currentTime + step));
        audioEngine.seek(time);
        store.setCurrentTime(time);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [audioEngine]);
}
