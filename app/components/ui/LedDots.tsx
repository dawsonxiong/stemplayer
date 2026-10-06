import { LED_PALETTE } from "~/lib/constants";

const STEP_MS = 120;

/** The device's five LED colours lighting in turn: the app's loading mark. */
export function LedDots() {
  return (
    <span className="flex gap-2" aria-hidden="true">
      {LED_PALETTE.map((colour, i) => (
        <span
          key={colour}
          className="led-boot h-2 w-2 rounded-full"
          style={{ backgroundColor: colour, animationDelay: `${i * STEP_MS}ms` }}
        />
      ))}
    </span>
  );
}
