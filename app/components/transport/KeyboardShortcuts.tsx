import { useId, useState } from "react";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play or pause"],
  ["1–4", "Mute a stem"],
  ["⇧ 1–4", "Isolate a stem"],
  ["[ ]", "Speed"],
  ["E", "Effects"],
  ["L", "Loop"],
  ["← →", "Seek"],
  ["P", "Power"],
];

/** A ⌘ button that shows the keyboard shortcuts, kept out of sight until
 *  asked for. Touch screens have no keyboard to use them with, so it's hidden
 *  there. */
export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const listId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        className="btn-secondary hidden self-stretch px-3.5 aria-expanded:bg-raised pointer-fine:inline-flex"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          aria-label="Keyboard shortcuts"
          className="panel-in hidden w-full basis-full flex-wrap gap-x-5 gap-y-2 text-caption text-ink-muted pointer-fine:flex"
        >
          {SHORTCUTS.map(([keys, action]) => (
            <li key={action} className="flex items-center gap-1.5">
              <kbd className="rounded-key px-1.5 py-0.5 text-ink inset-ring inset-ring-line">
                {keys}
              </kbd>
              {action}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
