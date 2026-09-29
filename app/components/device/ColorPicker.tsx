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
    <div role="group" aria-label="Device color" className="flex items-center gap-3">
      <span className="text-xs text-[var(--color-text-secondary)]">
        {DEVICE_COLORS[deviceColor].label}
      </span>
      <div className="flex gap-2">
        {COLORS.map(([name, { label, swatch }]) => {
          const selected = deviceColor === name;
          return (
            <button
              key={name}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => setDeviceColor(name)}
              className="h-5 w-5 rounded-full"
              // A ring for the selected swatch; focus-visible draws its own
              // outline, so none is set here.
              style={{
                backgroundColor: swatch,
                boxShadow: selected
                  ? "0 0 0 2px var(--color-bg-primary), 0 0 0 3px var(--color-text-primary)"
                  : "inset 0 0 0 1px rgba(0,0,0,0.18)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
