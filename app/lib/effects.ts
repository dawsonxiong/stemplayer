import type { AudioEngine } from "./audio/engine";
import { usePlayerStore } from "./store";

/** Shared by the Effects button and the E shortcut so both engage at the stored mix. */
export function toggleEffects(audioEngine: AudioEngine | null) {
  const effects = audioEngine?.effects;
  if (!effects) return;
  const store = usePlayerStore.getState();
  if (store.effectsMode) effects.bypass();
  else effects.engage(store.echo.wet);
  store.toggleEffectsMode();
}
