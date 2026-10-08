interface SegmentedProps<T extends string | number> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
}

/** A row of mutually exclusive choices, such as the effect or the speed. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format = String,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-full border border-line bg-page p-0.5 text-caption"
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={`flex-1 rounded-full px-1.5 py-1 tabular-nums transition-colors ${selected ? "text-ink inset-ring inset-ring-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {format(option)}
          </button>
        );
      })}
    </div>
  );
}
