import { usePlayerStore } from "~/lib/store";
import { formatTime } from "~/lib/utils/format";

export function TimeDisplay() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const buffering = usePlayerStore((s) => s.buffering);

  return (
    <span className="shrink-0 text-caption text-ink-muted tabular-nums">
      {/* Playing while it separates can catch up with the GPU. */}
      {buffering ? "Buffering…" : `${formatTime(currentTime)} / ${formatTime(duration)}`}
    </span>
  );
}
