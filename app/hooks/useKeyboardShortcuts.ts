import { useEffect } from "react";
import type { AudioEngine } from "~/lib/audio/engine";
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
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const store = usePlayerStore.getState();
      if (store.status !== "ready") return;

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
        const effects = audioEngine?.effects;
        if (!effects) return;
        if (store.effectsMode) {
          effects.bypass();
        } else {
          effects.engage();
        }
        store.toggleEffectsMode();
        return;
      }

      // Left/Right arrow — seek
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const time = Math.max(0, audioEngine!.currentTime - 5);
        audioEngine?.seek(time);
        store.setCurrentTime(time);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const time = Math.min(
          audioEngine!.duration,
          audioEngine!.currentTime + 5
        );
        audioEngine?.seek(time);
        store.setCurrentTime(time);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [audioEngine]);
}
