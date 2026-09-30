import type { AudioEngine } from "./audio/engine";
import { usePlayerStore } from "./store";

/** Pushes the store's effect settings to the audio. Call after any change. */
export function syncEffects(audioEngine: AudioEngine | null) {
  const { effectsMode, effect, echo, reverb, filter } = usePlayerStore.getState();
  audioEngine?.setEffects({ on: effectsMode, effect, echo, reverb, filter });
}

/** Shared by the Effects panel and the E shortcut. */
export function toggleEffects(audioEngine: AudioEngine | null) {
  usePlayerStore.getState().toggleEffectsMode();
  syncEffects(audioEngine);
}
