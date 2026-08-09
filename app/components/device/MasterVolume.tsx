import { usePlayerStore } from "~/lib/store";

/** Output level, driven by the device's side rocker. */
export function MasterVolume() {
  const masterVolume = usePlayerStore((s) => s.masterVolume);

  return (
    <div className="flex items-center justify-center gap-2">
      <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-muted)]">
        Vol
      </span>
      <div
        className="h-1 w-24 overflow-hidden rounded-full"
        style={{ backgroundColor: "rgba(0,0,0,0.08)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${masterVolume * 100}%`,
            backgroundColor: "var(--color-text-secondary)",
            transition: "width 120ms ease-out",
          }}
        />
      </div>
      <span className="w-8 text-[11px] tracking-[0.06em] text-[var(--color-text-muted)]">
        {Math.round(masterVolume * 100)}
      </span>
    </div>
  );
}
