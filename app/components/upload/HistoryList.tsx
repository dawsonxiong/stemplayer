import { useHistory, type HistoryEntry } from "~/lib/history";
import { formatTime } from "~/lib/utils/format";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

interface HistoryListProps {
  onOpen: (entry: HistoryEntry) => void;
}

/** Songs this browser already split, reopened without another GPU run. */
export function HistoryList({ onOpen }: HistoryListProps) {
  const entries = useHistory();
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="history-heading" className="panel-in flex w-full flex-col gap-2 pt-2">
      <h2
        id="history-heading"
        className="text-xs tracking-[0.12em] text-[var(--color-text-secondary)] uppercase"
      >
        Recent
      </h2>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.taskId}>
            <button
              type="button"
              onClick={() => onOpen(entry)}
              className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                {entry.title}
              </span>
              <span className="shrink-0 text-xs text-[var(--color-text-secondary)] tabular-nums">
                {[
                  entry.duration > 0 && formatTime(entry.duration),
                  DATE_FORMAT.format(entry.addedAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
