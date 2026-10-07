import { LedDots } from "~/components/ui/LedDots";

/** Shown while three.js and the model download: the five LED colours lighting
 *  in turn. Server-rendered, so it shows before any JavaScript runs. */
export function DeviceLoader() {
  return (
    <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-3">
      <LedDots />
      <span className="text-caption text-ink-muted">Loading…</span>
    </div>
  );
}
