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
      <span className="text-caption text-ink-muted">{DEVICE_COLORS[deviceColor].label}</span>
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
              // A ring for the selected swatch; focus-visible draws its own
              // outline, so none is set here.
              className={`h-5 w-5 rounded-full ${selected ? "ring-1 ring-ink ring-offset-2 ring-offset-page" : "inset-ring inset-ring-line-strong"}`}
              style={{ backgroundColor: swatch }}
            />
          );
        })}
      </div>
    </div>
  );
}
