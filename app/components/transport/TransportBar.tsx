import type { AudioEngine } from "~/lib/audio/engine";
import { usePlayerStore } from "~/lib/store";
import { PlayPauseButton } from "./PlayPauseButton";
import { Scrubber } from "./Scrubber";
import { TimeDisplay } from "./TimeDisplay";

interface TransportBarProps {
  audioEngine: AudioEngine | null;
}

export function TransportBar({ audioEngine }: TransportBarProps) {
  const status = usePlayerStore((s) => s.status);

  if (status !== "ready") return null;

  return (
    <div className="flex w-full max-w-md items-center gap-3 px-4">
      <PlayPauseButton audioEngine={audioEngine} />
      <Scrubber audioEngine={audioEngine} />
      <TimeDisplay />
    </div>
  );
}
