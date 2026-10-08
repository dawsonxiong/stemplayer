import { MATCHED_PROVIDERS } from "~/lib/links";
import { usePlayerStore, type Source, type Stage } from "~/lib/store";

/** `label` reads as under way, `done` as finished. `estimate` is a rough
 *  time, shown while the step is still to come or running, so a long wait
 *  doesn't read as a stall. */
type Step = { id: Stage; label: string; done: string; estimate: string };

// From the Modal job: an A10 that idles for 2 minutes after a run, so a cold
// start only some of the time, then ~8 s to separate, encode and store a
// 4-minute song.
const ESTIMATE = {
  upload: "~5\u00a0s",
  start: "up to 30\u00a0s",
  separate: "~10\u00a0s",
  load: "~5\u00a0s",
  lookup: "~2\u00a0s",
  fetch: "~15\u00a0s",
};

const UPLOAD_STEPS: Step[] = [
  { id: "upload", label: "Uploading", done: "Uploaded", estimate: ESTIMATE.upload },
  { id: "start", label: "Starting GPU", done: "GPU started", estimate: ESTIMATE.start },
  {
    id: "separate",
    label: "Separating stems",
    done: "Stems separated",
    estimate: ESTIMATE.separate,
  },
  { id: "load", label: "Loading stems", done: "Stems loaded", estimate: ESTIMATE.load },
];

/** A link has nothing to upload. It's looked up first, which checks the song
 *  exists and gets its title, then the GPU job fetches it once it's running,
 *  finding Spotify and Apple Music songs on YouTube first. */
function stepsFor(source: Source): Step[] {
  if (source === "file") return UPLOAD_STEPS;
  const matched = MATCHED_PROVIDERS.includes(source);
  // Everything but the upload is shared with a file's steps.
  const [, start, separate, load] = UPLOAD_STEPS;
  return [
    { id: "lookup", label: "Getting song", done: "Song found", estimate: ESTIMATE.lookup },
    start,
    {
      id: "fetch",
      label: matched ? "Finding on YouTube" : "Downloading audio",
      done: matched ? "Found on YouTube" : "Audio downloaded",
      estimate: ESTIMATE.fetch,
    },
    separate,
    load,
  ];
}

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
  // Muted, not faded: still 5:1 against the page.
  pending: "text-ink-muted",
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

  const steps = stepsFor(source ?? "file");
  const current = steps.findIndex((s) => s.id === stage);

  return (
    <div className="panel-in w-full">
      <p aria-live="polite" className="sr-only">
        {failed ? `${steps[current]?.label} failed` : steps[current]?.label}
      </p>
      <ol aria-label="Progress" className="flex w-full flex-col">
        {steps.map((step, i) => {
          const state: StepState =
            i < current ? "done" : i > current ? "pending" : failed ? "failed" : "active";
          // Done steps need nothing; the upload counts up its own progress.
          // After a failure the rest won't run, so they get no estimate.
          const detail =
            state === "failed"
              ? "Failed"
              : state === "done" || failed
                ? null
                : state === "active" && step.id === "upload"
                  ? `${Math.round(progress)}%`
                  : step.estimate;

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
                {state === "done" ? step.done : step.label}
                {state === "pending" && <span className="sr-only">, waiting</span>}
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
