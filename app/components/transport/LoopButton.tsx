import type { AudioEngine } from "~/lib/audio/engine";
import { cycleLoop } from "~/lib/loop";
import { usePlayerStore } from "~/lib/store";

interface LoopButtonProps {
  audioEngine: AudioEngine | null;
}

export function LoopButton({ audioEngine }: LoopButtonProps) {
  const loop = usePlayerStore((s) => s.loop);
  const pending = loop.start !== null && loop.end === null;
  const active = loop.end !== null;

  const label = active ? "Clear loop" : pending ? "Set loop end" : "Set loop start";

  return (
    <button
      type="button"
      onClick={() => cycleLoop(audioEngine)}
      // Dashed while waiting for the out point, solid once the loop is set.
      className={`btn-icon ${pending ? "border-dashed" : ""} ${active || pending ? "border-cyan-ink" : ""}`}
      // The label already names the next action; "pressed" on top of it would
      // read as "Clear loop, pressed".
      aria-label={label}
      title={`${label} (L)`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke={active || pending ? "var(--color-cyan-ink)" : "var(--color-ink-muted)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 2.5l2 2-2 2" />
        <path d="M3 8V6.5a2 2 0 0 1 2-2h8" />
        <path d="M5 13.5l-2-2 2-2" />
        <path d="M13 8v1.5a2 2 0 0 1-2 2H3" />
      </svg>
    </button>
  );
}
