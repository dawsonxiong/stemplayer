import { useId, type ReactNode } from "react";

/** The label column every panel row lines up on: label, control, readout. */
const ROW = "grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3";

/** A labelled row whose control spans the control and readout columns. */
export function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={ROW}>
      <span className="text-caption text-ink-muted">{label}</span>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={ROW}>
      <label htmlFor={id} className="text-caption text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider-input w-full"
        style={
          {
            "--slider-pct": `${pct}%`,
            "--slider-color": "var(--color-ink)",
          } as React.CSSProperties
        }
      />
      <output htmlFor={id} className="text-right text-caption tabular-nums text-ink-muted">
        {format(value)}
      </output>
    </div>
  );
}
