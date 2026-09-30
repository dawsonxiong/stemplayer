import type { Route } from "./+types/home";
import { useCallback, useEffect } from "react";
import { Device } from "~/components/device/Device";
import { ColorPicker } from "~/components/device/ColorPicker";
import { DeviceIcon } from "~/components/device/DeviceIcon";
import { MasterVolume } from "~/components/device/MasterVolume";
import { TransportBar } from "~/components/transport/TransportBar";
import { KeyboardShortcuts } from "~/components/transport/KeyboardShortcuts";
import { SpeedControl } from "~/components/transport/SpeedControl";
import { EffectsPanel } from "~/components/effects/EffectsPanel";
import { UploadZone } from "~/components/upload/UploadZone";
import { ProcessingSteps } from "~/components/upload/ProcessingSteps";
import { HistoryList } from "~/components/upload/HistoryList";
import { useAudioEngine } from "~/hooks/useAudioEngine";
import { useKeyboardShortcuts } from "~/hooks/useKeyboardShortcuts";
import { usePlayerStore, type Stage } from "~/lib/store";
import { MODEL_URL } from "~/lib/model";
import { trackDetails } from "~/lib/utils/format";
import { titleFromFilename } from "~/lib/utils/title";
import { findTrack, forgetTrack, rememberTrack } from "~/lib/history";
import {
  hashFile,
  requestUploadUrl,
  uploadFileToR2,
  triggerSeparation,
  pollStatus,
  fetchStemUrls,
  TrackNotFoundError,
  UserFacingError,
} from "~/lib/api";

// Said in the product's voice: what happened, then what to do.
const EXPIRED_ERROR = "That song has expired. Drop it again to split it.";
const OPEN_ERROR = "That song didn’t load. Check your connection and try again.";

const STAGE_ERRORS: Record<Stage, string> = {
  upload: "The upload didn’t finish. Check your connection, then drop the song again.",
  start: "The GPU didn’t start. Drop the song again to retry.",
  separate: "Separating the stems failed. Drop the song again to retry.",
  load: "The stems are ready but didn’t load. Reload the page to try again.",
};

/** Adds the loaded song to this browser's history. */
function remember(taskId: string) {
  const { trackTitle, duration, trackDate } = usePlayerStore.getState();
  rememberTrack({ taskId, title: trackTitle, duration, addedAt: trackDate ?? Date.now() });
}

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
  const trackDate = usePlayerStore((s) => s.trackDate);
  const duration = usePlayerStore((s) => s.duration);
  const errorMessage = usePlayerStore((s) => s.errorMessage);
  const isOn = usePlayerStore((s) => s.isOn);
  const uploadStage = usePlayerStore((s) => s.stage);

  useKeyboardShortcuts(audioEngine);

  const handleFileSelected = useCallback(
    async (file: File) => {
      const store = usePlayerStore.getState();
      store.reset();
      store.setTrackTitle(titleFromFilename(file.name));
      store.setTrackDate(Date.now());
      let stage: Stage = "upload";
      const enter = (next: Stage) => {
        stage = next;
        store.setStage(next);
        store.setProcessingProgress(0);
      };

      try {
        enter("upload");
        store.setStatus("uploading");
        // A failed hash only costs the cache hit, never the upload.
        const hash = await hashFile(file).catch(() => null);
        const ticket = await requestUploadUrl(file, hash);
        const { taskId } = ticket;
        store.setTaskId(taskId);

        // Split before: its stems are already there, so skip straight to loading.
        if ("uploadUrl" in ticket) {
          await uploadFileToR2(ticket.uploadUrl, file, (progress) => {
            store.setProcessingProgress(progress);
          });

          enter("start");
          store.setStatus("processing");
          await triggerSeparation(taskId);

          // The job's first progress report means the GPU is up and working.
          await pollStatus(taskId, (progress) => {
            if (progress > 0 && usePlayerStore.getState().stage === "start") enter("separate");
            store.setProcessingProgress(progress);
          });
        } else {
          store.setStatus("processing");
        }

        // Set before loading, so a reload retries the load and not the GPU run.
        enter("load");
        setTrackParam(taskId);
        const { stems, createdAt } = await fetchStemUrls(taskId);
        await audioEngine?.loadStems(stems);
        // Known once the stems load; otherwise it only updates during playback.
        store.setDuration(audioEngine?.duration ?? 0);
        // A cached song keeps its original date, which is also when it expires.
        if (createdAt) store.setTrackDate(createdAt);
        remember(taskId);

        store.setStatus("ready");
        store.setStage(null);
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

  /** Loads a song that was split before, from a link, a reload or history. */
  const openTrack = useCallback(
    async (taskId: string, knownTitle?: string) => {
      if (!audioEngine) return;
      const store = usePlayerStore.getState();
      store.reset();
      store.setTaskId(taskId);
      // No stage: it's one quick load, not the upload's multi-step run, so the
      // title and a "Loading" line stand in for the steps.
      if (knownTitle) store.setTrackTitle(knownTitle);
      store.setStatus("processing");
      setTrackParam(taskId);

      try {
        const { stems, title, createdAt } = await fetchStemUrls(taskId);
        await audioEngine.loadStems(stems);
        store.setDuration(audioEngine.duration);
        store.setTrackTitle(knownTitle ?? titleFromFilename(title));
        store.setTrackDate(createdAt);
        remember(taskId);
        // No autoplay: the browser wants a gesture before audio starts.
        store.setStatus("ready");
      } catch (err) {
        // Only a missing task is gone for good; a dropped connection isn't.
        const expired = err instanceof TrackNotFoundError;
        if (expired) forgetTrack(taskId);
        setTrackParam(null);
        store.reset();
        store.setStatus("error");
        store.setErrorMessage(expired ? EXPIRED_ERROR : OPEN_ERROR);
      }
    },
    [audioEngine],
  );

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get("t");
    if (!taskId || usePlayerStore.getState().status !== "idle") return;
    // A cached song's task can come from someone else's upload, so prefer the
    // title this browser gave it over the name stored with the task.
    void openTrack(taskId, findTrack(taskId)?.title);
  }, [openTrack]);

  useEffect(() => {
    document.title =
      trackTitle && status === "ready" ? `${trackTitle} – Stem Player` : "Stem Player";
  }, [trackTitle, status]);

  const handleNewTrack = useCallback(() => {
    audioEngine?.dispose();
    usePlayerStore.getState().reset();
    setTrackParam(null);
  }, [audioEngine]);

  const togglePower = useCallback(() => {
    usePlayerStore.getState().setPower(true);
  }, []);

  const busy = status === "uploading" || status === "processing";
  const hasTrack = Boolean(trackTitle) && status !== "idle";

  return (
    <main className="relative z-10 flex min-h-screen flex-col items-center px-4 pt-10 pb-8 sm:pt-14 sm:pb-12 lg:px-10 lg:pt-8">
      <header className="flex w-full max-w-6xl justify-center lg:justify-start">
        {/* The product's own logotype, so the one place type is set in caps. */}
        <h1 className="flex items-center gap-3 text-wordmark text-ink uppercase">
          <DeviceIcon className="h-7 w-auto" />
          Stem Player
        </h1>
      </header>

      {/* Stacked on phones; on wide screens the device takes the left and the
          controls sit beside it, the pair centred in the window. */}
      <div className="flex w-full flex-1 flex-col items-center lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-16">
        <div className="flex w-full flex-col items-center">
          <Device audioEngine={audioEngine} />
          {/* Under the device it recolours, out of the way while the steps show. */}
          {!busy && (
            <div className="panel-in relative z-10 mt-5">
              <ColorPicker />
            </div>
          )}
        </div>

        {/* Stacked above the 3D canvas, which overflows down into this space. */}
        <div className="relative z-10 mt-8 flex w-full max-w-sm flex-col gap-5 lg:mt-0 lg:max-w-none">
          {hasTrack ? (
            <div className="flex flex-col items-center gap-1.5 text-center lg:items-start lg:text-left">
              <p className="line-clamp-3 text-display text-balance text-ink">{trackTitle}</p>
              {status === "ready" ? (
                <p className="text-caption text-ink-muted tabular-nums">
                  {trackDetails(duration, trackDate)}
                </p>
              ) : (
                // An upload's steps say what's happening; a reopened song has none.
                busy && !uploadStage && <p className="text-caption text-ink-muted">Loading</p>
              )}
            </div>
          ) : busy ? (
            <p className="text-center text-body text-ink-muted lg:text-left">Loading your song</p>
          ) : (
            <div className="flex flex-col gap-3 text-center lg:text-left">
              <h2 className="text-display text-balance text-ink">
                Split any song into vocals, drums, bass and everything else.
              </h2>
              <p className="text-body text-pretty text-ink-muted">
                Then mix them live by dragging the four lit grooves on the device.
              </p>
            </div>
          )}

          {status === "ready" && !isOn && (
            <p className="text-center text-body text-ink-muted lg:text-left">
              The device is off. Hold its centre button for a second, or{" "}
              <button
                type="button"
                onClick={togglePower}
                className="text-ink underline underline-offset-4"
              >
                turn it on
              </button>
              .
            </p>
          )}

          <TransportBar audioEngine={audioEngine} />
          <EffectsPanel audioEngine={audioEngine} />
          <ProcessingSteps />

          {status === "ready" && (
            <div className="panel-in flex flex-wrap items-center justify-center gap-x-8 gap-y-3 lg:justify-start">
              <MasterVolume audioEngine={audioEngine} />
              <SpeedControl audioEngine={audioEngine} />
            </div>
          )}

          {status === "error" && errorMessage && (
            <p
              role="alert"
              className="text-center text-body text-balance text-magenta-ink lg:text-left"
            >
              {errorMessage}
            </p>
          )}

          <UploadZone onFileSelected={handleFileSelected} />
          {(status === "idle" || status === "error") && (
            <HistoryList onOpen={(entry) => void openTrack(entry.taskId, entry.title)} />
          )}

          {status === "ready" && (
            <footer className="mt-4 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-5 lg:justify-start">
              <button type="button" onClick={handleNewTrack} className="btn-secondary">
                Load another song
              </button>
              <KeyboardShortcuts />
            </footer>
          )}
        </div>
      </div>
    </main>
  );
}
