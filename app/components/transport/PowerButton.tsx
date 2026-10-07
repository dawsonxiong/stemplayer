import type { AudioEngine } from "~/lib/audio/engine";
import { setPower } from "~/lib/mix";
import { usePlayerStore } from "~/lib/store";

/** Turns the device off and on, which on the device itself takes holding the
 *  centre button: a plain button for keyboards, switches and screen readers. */
export function PowerButton({ audioEngine }: { audioEngine: AudioEngine | null }) {
  const isOn = usePlayerStore((s) => s.isOn);
  const label = isOn ? "Turn the device off" : "Turn the device on";

  return (
    <button
      type="button"
      onClick={() => setPower(audioEngine, !isOn)}
      aria-label={label}
      title={`${label} (P)`}
      className="btn-secondary btn-secondary-icon"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 3v9" />
        <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
      </svg>
    </button>
  );
}
