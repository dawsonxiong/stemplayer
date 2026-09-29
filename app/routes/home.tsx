import type { Route } from "./+types/home";
import { useCallback, useEffect } from "react";
import { Device } from "~/components/device/Device";
import { ColorPicker } from "~/components/device/ColorPicker";
import { MasterVolume } from "~/components/device/MasterVolume";
import { TransportBar } from "~/components/transport/TransportBar";
import { EffectsPanel } from "~/components/effects/EffectsPanel";
import { UploadZone } from "~/components/upload/UploadZone";
import { UploadProgress } from "~/components/upload/UploadProgress";
import { DriftMeter } from "~/components/DriftMeter";
import { useAudioEngine } from "~/hooks/useAudioEngine";
import { useKeyboardShortcuts } from "~/hooks/useKeyboardShortcuts";
import { usePlayerStore } from "~/lib/store";
import { MODEL_URL } from "~/lib/model";
import {
  requestUploadUrl,
  uploadFileToR2,
  triggerSeparation,
  pollStatus,
  fetchStemUrls,
  UserFacingError,
} from "~/lib/api";

type Stage = "upload" | "separate" | "load";

// Said in the product's voice: what happened, then what to do.
const STAGE_ERRORS: Record<Stage, string> = {
  upload: "The upload didn’t finish. Check your connection, then drop the song again.",
  separate: "Separating the stems failed. Drop the song again to retry.",
  load: "The stems are ready but didn’t load. Reload the page to try again.",
};

/** Reloads and shared links bring a separated track back without a new GPU run. */
function setTrackParam(taskId: string | null) {
  const url = new URL(window.location.href);
  if (taskId) url.searchParams.set("t", taskId);
  else url.searchParams.delete("t");
  window.history.replaceState(null, "", url);
}

// Start the model download with the page instead of after three.js has
// loaded and parsed. Same-origin fetch, so it matches useGLTF's request.
export const links: Route.LinksFunction = () => [
  { rel: "preload", href: MODEL_URL, as: "fetch", crossOrigin: "anonymous" },
];

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Stem Player" },
    {
      name: "description",
      content: "Upload any song, separate it into stems, and mix it live in your browser.",
    },
  ];
};

export default function Home() {
  const audioEngine = useAudioEngine();
  const status = usePlayerStore((s) => s.status);
  const trackTitle = usePlayerStore((s) => s.trackTitle);
  const errorMessage = usePlayerStore((s) => s.errorMessage);
  const separateProgress = usePlayerStore((s) => s.processingProgress);
  const isOn = usePlayerStore((s) => s.isOn);

  useKeyboardShortcuts(audioEngine);

  const handleFileSelected = useCallback(
    async (file: File) => {
      const store = usePlayerStore.getState();
      store.reset();
      store.setTrackTitle(file.name.replace(/\.[^.]+$/, ""));
      let stage: Stage = "upload";

      try {
        store.setStatus("uploading");
        const { taskId, uploadUrl } = await requestUploadUrl(file);
        store.setTaskId(taskId);

        await uploadFileToR2(uploadUrl, file, (progress) => {
          store.setProcessingProgress(progress);
        });

        stage = "separate";
        store.setStatus("processing");
        store.setProcessingProgress(0);
        await triggerSeparation(taskId);

        await pollStatus(taskId, (progress) => {
          store.setProcessingProgress(progress);
        });

        // Set before loading, so a reload retries the load and not the GPU run.
        stage = "load";
        setTrackParam(taskId);
        const { stems } = await fetchStemUrls(taskId);
        await audioEngine?.loadStems(stems);

        store.setStatus("ready");
        // Autoplay only if the device was left on while the track separated.
        if (usePlayerStore.getState().isOn) {
          audioEngine?.play();
          store.setPlaying(true);
        }
      } catch (err) {
        store.setStatus("error");
        store.setErrorMessage(err instanceof UserFacingError ? err.message : STAGE_ERRORS[stage]);
      }
    },
    [audioEngine],
  );

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get("t");
    if (!audioEngine || !taskId) return;

    const store = usePlayerStore.getState();
    if (store.status !== "idle") return;
    store.setTaskId(taskId);
    store.setStatus("processing");

    fetchStemUrls(taskId)
      .then(async ({ stems, title }) => {
        await audioEngine.loadStems(stems);
        store.setTrackTitle(title.replace(/\.[^.]+$/, ""));
        // No autoplay: the browser wants a gesture before audio starts.
        store.setStatus("ready");
      })
      .catch(() => {
        setTrackParam(null);
        store.reset();
      });
  }, [audioEngine]);

  const handleNewTrack = useCallback(() => {
    audioEngine?.dispose();
    usePlayerStore.getState().reset();
    setTrackParam(null);
  }, [audioEngine]);

  const togglePower = useCallback(() => {
    usePlayerStore.getState().setPower(true);
  }, []);

  const busy = status === "uploading" || status === "processing";

  return (
    <main className="relative z-10 flex min-h-screen flex-col items-center px-4 py-8 sm:py-12">
      <header className="flex w-full max-w-md flex-col items-center gap-2 text-center">
        <h1 className="max-w-full truncate text-xl tracking-[0.16em] text-[var(--color-text-primary)] uppercase sm:text-2xl">
          {trackTitle && (busy || status === "ready") ? trackTitle : "Stem Player"}
        </h1>
        {busy ? (
          <p aria-live="polite" className="text-sm text-[var(--color-text-secondary)] tabular-nums">
            {status === "uploading"
              ? "Uploading"
              : `Separating stems${separateProgress > 0 ? `, ${Math.round(separateProgress)}%` : ""}`}
          </p>
        ) : status !== "ready" ? (
          <p className="text-sm text-balance text-[var(--color-text-secondary)]">
            Split a song into vocals, drums, bass and the rest, then mix it live.
          </p>
        ) : null}
      </header>

      <div className="w-full">
        <Device audioEngine={audioEngine} />
      </div>

      {/* Stacked above the 3D canvas, which overflows down into this space. */}
      <div className="relative z-10 mt-6 flex w-full max-w-sm flex-col gap-4">
        {status === "ready" && !isOn && (
          <p className="text-center text-sm text-[var(--color-text-secondary)]">
            The device is off. Hold its centre button for a second, or{" "}
            <button
              type="button"
              onClick={togglePower}
              className="text-[var(--color-text-primary)] underline underline-offset-4"
            >
              turn it on
            </button>
            .
          </p>
        )}

        <TransportBar audioEngine={audioEngine} />
        <EffectsPanel audioEngine={audioEngine} />
        <UploadProgress />

        {status === "error" && errorMessage && (
          <p
            role="alert"
            className="text-center text-sm text-balance text-[var(--color-magenta-ink)]"
          >
            {errorMessage}
          </p>
        )}

        <UploadZone onFileSelected={handleFileSelected} />

        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 pt-2">
          <ColorPicker />
          {/* Nothing to turn up until a song has been uploaded. */}
          {status !== "idle" && <MasterVolume audioEngine={audioEngine} />}
        </div>
      </div>

      {status === "ready" && (
        <footer className="relative z-10 mt-10 flex w-full max-w-sm flex-col items-center gap-5">
          <button
            type="button"
            onClick={handleNewTrack}
            className="text-sm text-[var(--color-text-primary)] underline-offset-4 hover:underline"
          >
            Load another song
          </button>

          <ul
            aria-label="Keyboard shortcuts"
            // Touch screens have no keyboard to use them with.
            className="hidden flex-wrap pointer-fine:flex justify-center gap-x-5 gap-y-2 text-xs text-[var(--color-text-secondary)]"
          >
            {SHORTCUTS.map(([keys, action]) => (
              <li key={action} className="flex items-center gap-1.5">
                <kbd
                  className="rounded px-1.5 py-0.5 font-[inherit] text-[var(--color-text-primary)]"
                  style={{ boxShadow: "inset 0 0 0 1px var(--color-border)" }}
                >
                  {keys}
                </kbd>
                {action}
              </li>
            ))}
          </ul>

          {import.meta.env.DEV && <DriftMeter audioEngine={audioEngine} />}
        </footer>
      )}
    </main>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play or pause"],
  ["1–4", "Mute a stem"],
  ["E", "Echo"],
  ["L", "Loop"],
  ["← →", "Seek"],
];
