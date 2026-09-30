import { usePlayerStore, type Stage } from "~/lib/store";

const STEPS: { id: Stage; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "start", label: "Start GPU" },
  { id: "separate", label: "Separate stems" },
  { id: "load", label: "Load stems" },
];

/** The four stages a song goes through, each lit like one of the device's
 *  LEDs as it finishes. Stays up on failure to show which stage broke. */
export function ProcessingSteps() {
  const status = usePlayerStore((s) => s.status);
  const stage = usePlayerStore((s) => s.stage);
  const progress = usePlayerStore((s) => s.processingProgress);

  const failed = status === "error";
  if (!stage || (status !== "uploading" && status !== "processing" && !failed)) return null;

  const current = STEPS.findIndex((s) => s.id === stage);

  return (
    <div className="panel-in mx-auto w-full max-w-xs">
      <p aria-live="polite" className="sr-only">
        {failed ? `${STEPS[current]?.label} failed` : STEPS[current]?.label}
      </p>
      <ol aria-label="Progress" className="flex w-full flex-col">
        {STEPS.map((step, i) => {
          const state =
            i < current ? "done" : i > current ? "pending" : failed ? "failed" : "active";
          const detail =
            state !== "active"
              ? state === "failed"
                ? "Failed"
                : null
              : step.id === "upload"
                ? `${Math.round(progress)}%`
                : null;

          return (
            <li
              key={step.id}
              aria-current={state === "active" ? "step" : undefined}
              className="relative flex items-center gap-3 py-1.5"
            >
              {/* The rail joining this LED to the next one. */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute top-[calc(50%+6px)] left-[4px] h-[calc(100%-12px)] w-px"
                  style={{ backgroundColor: "var(--color-well)" }}
                >
                  {/* Fills top to bottom once this stage is done. */}
                  <span
                    className="absolute inset-0 origin-top transition-transform duration-500 ease-out motion-reduce:transition-none"
                    style={{
                      backgroundColor: "var(--color-cyan-ink)",
                      transform: `scaleY(${i < current ? 1 : 0})`,
                    }}
                  />
                </span>
              )}
              <span
                aria-hidden="true"
                className={`relative h-[9px] w-[9px] shrink-0 rounded-full transition-[background-color,box-shadow] duration-500 ease-out motion-reduce:transition-none ${state === "active" ? "step-pulse" : ""}`}
                style={{
                  backgroundColor:
                    state === "done"
                      ? "var(--color-led-cyan)"
                      : state === "active"
                        ? "var(--color-led-magenta)"
                        : state === "failed"
                          ? "var(--color-magenta-ink)"
                          : "var(--color-well)",
                  boxShadow:
                    state === "done"
                      ? "0 0 5px var(--color-led-cyan), inset 0 0 0 1px var(--color-cyan-ink)"
                      : state === "active"
                        ? "0 0 6px var(--color-led-magenta)"
                        : "inset 0 1px 1px rgba(0,0,0,0.15)",
                }}
              />
              <span
                className="text-sm transition-[color,opacity] duration-500 ease-out motion-reduce:transition-none"
                style={{
                  color:
                    state === "failed"
                      ? "var(--color-magenta-ink)"
                      : state === "pending"
                        ? "var(--color-text-secondary)"
                        : "var(--color-text-primary)",
                  opacity: state === "pending" ? 0.7 : 1,
                }}
              >
                {step.label}
                <span className="sr-only">
                  {state === "done" ? ", done" : state === "pending" ? ", waiting" : ""}
                </span>
              </span>
              {detail && (
                <span
                  className="ml-auto text-xs tabular-nums"
                  style={{
                    color: failed ? "var(--color-magenta-ink)" : "var(--color-text-secondary)",
                  }}
                >
                  {detail}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
