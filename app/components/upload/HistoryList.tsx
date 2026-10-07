import { useHistory, type HistoryEntry } from "~/lib/history";
import { trackDetails } from "~/lib/utils/format";

interface HistoryListProps {
  onOpen: (entry: HistoryEntry) => void;
}

/** Songs this browser already split, reopened without another GPU run. */
export function HistoryList({ onOpen }: HistoryListProps) {
  const entries = useHistory();
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="history-heading" className="panel-in mt-4 flex w-full flex-col gap-1">
      <h2 id="history-heading" className="text-caption text-ink-muted">
        Recent songs
      </h2>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.taskId} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => onOpen(entry)}
              className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-0.5 rounded-row px-2 py-2.5 text-left transition-colors hover:bg-raised"
            >
              <span className="line-clamp-2 text-body wrap-break-word text-ink">{entry.title}</span>
              <span className="text-caption text-ink-muted tabular-nums">
                {trackDetails(entry.duration, entry.addedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
