import { usePlayerStore, type Source, type Stage } from "~/lib/store";

const STEPS: Record<Source, { id: Stage; label: string }[]> = {
  file: [
    { id: "upload", label: "Upload" },
    { id: "start", label: "Start GPU" },
    { id: "separate", label: "Separate stems" },
    { id: "load", label: "Load stems" },
  ],
  // Nothing to upload: the GPU job downloads the video once it's running.
  link: [
    { id: "start", label: "Start GPU" },
    { id: "fetch", label: "Download audio" },
    { id: "separate", label: "Separate stems" },
    { id: "load", label: "Load stems" },
  ],
};

type StepState = "done" | "active" | "failed" | "pending";

const LED_CLASS: Record<StepState, string> = {
  done: "bg-led-cyan",
  active: "bg-led-magenta",
  failed: "bg-magenta-ink",
  pending: "bg-well",
};

const LABEL_CLASS: Record<StepState, string> = {
  done: "text-ink",
  active: "text-ink",
  failed: "text-magenta-ink",
  pending: "text-ink-muted opacity-70",
};

/** The four stages a song goes through, each lit like one of the device's
 *  LEDs as it finishes. Stays up on failure to show which stage broke. */
export function ProcessingSteps() {
  const status = usePlayerStore((s) => s.status);
  const stage = usePlayerStore((s) => s.stage);
  const progress = usePlayerStore((s) => s.processingProgress);
  const source = usePlayerStore((s) => s.source);

  const failed = status === "error";
  if (!stage || (status !== "uploading" && status !== "processing" && !failed)) return null;

  const steps = STEPS[source ?? "file"];
  const current = steps.findIndex((s) => s.id === stage);

  return (
    <div className="panel-in mx-auto w-full max-w-xs lg:mx-0">
      <p aria-live="polite" className="sr-only">
        {failed ? `${steps[current]?.label} failed` : steps[current]?.label}
      </p>
      <ol aria-label="Progress" className="flex w-full flex-col">
        {steps.map((step, i) => {
          const state: StepState =
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
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute top-[calc(50%+6px)] left-[4px] h-[calc(100%-12px)] w-px bg-well"
                >
                  {/* Fills top to bottom once this stage is done. */}
                  <span
                    className="absolute inset-0 origin-top bg-cyan-ink transition-transform duration-500 ease-out motion-reduce:transition-none"
                    style={{ transform: `scaleY(${i < current ? 1 : 0})` }}
                  />
                </span>
              )}
              <span
                aria-hidden="true"
                className={`relative h-[9px] w-[9px] shrink-0 rounded-full transition-colors duration-500 ease-out motion-reduce:transition-none ${LED_CLASS[state]} ${state === "active" ? "step-pulse" : ""}`}
              />
              <span
                className={`text-body transition-[color,opacity] duration-500 ease-out motion-reduce:transition-none ${LABEL_CLASS[state]}`}
              >
                {step.label}
                <span className="sr-only">
                  {state === "done" ? ", done" : state === "pending" ? ", waiting" : ""}
                </span>
              </span>
              {detail && (
                <span
                  className={`ml-auto text-caption tabular-nums ${failed ? "text-magenta-ink" : "text-ink-muted"}`}
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
