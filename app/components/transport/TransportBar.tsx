import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { LoopButton } from "./LoopButton";
import { PlayPauseButton } from "./PlayPauseButton";
import { RecordButton } from "./RecordButton";
import { Scrubber } from "./Scrubber";
import { TimeDisplay } from "./TimeDisplay";

interface TransportBarProps {
  audioEngine: AudioEngine | null;
}

export function TransportBar({ audioEngine }: TransportBarProps) {
  const status = usePlayerStore((s) => s.status);

  if (status !== "ready") return null;

  return (
    <div
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <PlayPauseButton audioEngine={audioEngine} />
      <Scrubber audioEngine={audioEngine} />
      <TimeDisplay />
      <LoopButton audioEngine={audioEngine} />
      <RecordButton audioEngine={audioEngine} />
    </div>
  );
}
