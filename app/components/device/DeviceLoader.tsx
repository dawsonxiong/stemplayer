import { LED_PALETTE } from "~/lib/constants";

const STEP_MS = 120;

/** Shown while three.js and the model download: the five LED colours lighting
 *  in turn. Server-rendered, so it shows before any JavaScript runs. */
export function DeviceLoader() {
  return (
    <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="flex gap-2" aria-hidden="true">
        {LED_PALETTE.map((colour, i) => (
          <span
            key={colour}
            className="led-boot h-2 w-2 rounded-full"
            style={{
              backgroundColor: colour,
              animationDelay: `${i * STEP_MS}ms`,
            }}
          />
        ))}
      </div>
      <span className="text-caption text-ink-muted">Loading</span>
    </div>
  );
}
