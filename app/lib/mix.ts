import type { AudioEngine } from "./audio/engine";
import { SPEEDS, type StemName } from "./constants";
import { usePlayerStore } from "./store";

/** Adds or removes a stem from the ones playing on their own. */
export function setStemIsolated(audioEngine: AudioEngine | null, stem: StemName, on: boolean) {
  const store = usePlayerStore.getState();
  const has = store.isolated.includes(stem);
  if (has === on) return;
  const next = on ? [...store.isolated, stem] : store.isolated.filter((s) => s !== stem);
  store.setIsolated(next);
  audioEngine?.setIsolated(next);
}

export function toggleIsolated(audioEngine: AudioEngine | null, stem: StemName) {
  setStemIsolated(audioEngine, stem, !usePlayerStore.getState().isolated.includes(stem));
}

export function setSpeed(audioEngine: AudioEngine | null, speed: number) {
  usePlayerStore.getState().setSpeed(speed);
  audioEngine?.setSpeed(speed);
}

/** One step slower or faster through SPEEDS, for the [ and ] keys. */
export function stepSpeed(audioEngine: AudioEngine | null, direction: -1 | 1) {
  const i = SPEEDS.indexOf(usePlayerStore.getState().speed as (typeof SPEEDS)[number]);
  const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + direction))];
  setSpeed(audioEngine, next);
}

/** What each stem is heard at: its level, or nothing while others play alone. */
export function audibleLevels(
  volumes: Record<StemName, number>,
  isolated: StemName[],
): Record<StemName, number> {
  if (isolated.length === 0) return volumes;
  const out = { ...volumes };
  for (const stem of Object.keys(out) as StemName[]) {
    if (!isolated.includes(stem)) out[stem] = 0;
  }
  return out;
}

/** Powering off silences and stops, like pulling the plug. Shared by the
 *  device's centre button, the P key and the power button on the page. */
export function setPower(audioEngine: AudioEngine | null, on: boolean) {
  const store = usePlayerStore.getState();
  store.setPower(on);
  if (!on) {
    audioEngine?.pause();
    store.setPlaying(false);
  }
}
