import { DEVICE_COLORS, type DeviceColor } from "~/lib/constants";
import { usePlayerStore } from "~/lib/store";

const COLORS = Object.entries(DEVICE_COLORS) as [
  DeviceColor,
  (typeof DEVICE_COLORS)[DeviceColor],
][];

export function ColorPicker() {
  const deviceColor = usePlayerStore((s) => s.deviceColor);
  const setDeviceColor = usePlayerStore((s) => s.setDeviceColor);

  return (
    <div className="flex items-center justify-center gap-3">
      <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-muted)]">
        Color: {DEVICE_COLORS[deviceColor].label}
      </span>
      <div className="flex gap-2">
        {COLORS.map(([name, { label, swatch }]) => (
          <button
            key={name}
            type="button"
            aria-label={label}
            aria-pressed={deviceColor === name}
            onClick={() => setDeviceColor(name)}
            className="h-5 w-5 rounded-full transition-all"
            style={{
              backgroundColor: swatch,
              border: `1px solid ${deviceColor === name ? "var(--color-text-primary)" : "var(--color-border)"}`,
              outline:
                deviceColor === name
                  ? "1px solid var(--color-text-primary)"
                  : "none",
              outlineOffset: "2px",
            }}
          />
        ))}
      </div>
    </div>
  );
}
