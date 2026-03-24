import { usePlayerStore } from "~/lib/store";
import { formatTime } from "~/lib/utils/format";

export function TimeDisplay() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  return (
    <span
      className="shrink-0 text-xs tabular-nums"
      style={{
        color: "var(--color-text-secondary)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {formatTime(currentTime)} / {formatTime(duration)}
    </span>
  );
}
