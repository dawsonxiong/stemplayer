"use client";

import { useCallback, useEffect, useRef } from "react";
import { preload } from "react-dom";
import { Device } from "~/components/device/Device";
import { ColorPicker } from "~/components/device/ColorPicker";
import { DeviceIcon } from "~/components/device/DeviceIcon";
import { MasterVolume } from "~/components/device/MasterVolume";
import { TransportBar } from "~/components/transport/TransportBar";
import { KeyboardShortcuts } from "~/components/transport/KeyboardShortcuts";
import { SpeedControl } from "~/components/transport/SpeedControl";
import { PowerButton } from "~/components/transport/PowerButton";
import { setPower } from "~/lib/mix";
import { EffectsPanel } from "~/components/effects/EffectsPanel";
import { UploadZone } from "~/components/upload/UploadZone";
import { ProcessingSteps } from "~/components/upload/ProcessingSteps";
import { HistoryList } from "~/components/upload/HistoryList";
import { useAudioEngine } from "~/hooks/useAudioEngine";
import { LedDots } from "~/components/ui/LedDots";
import { useKeyboardShortcuts } from "~/hooks/useKeyboardShortcuts";
import { usePlayerStore, type Source, type Stage } from "~/lib/store";
import { MODEL_URL } from "~/lib/model";
import { trackDetails } from "~/lib/utils/format";
import { titleFromFilename } from "~/lib/utils/title";
import { findTrack, forgetTrack, rememberTrack } from "~/lib/history";
import { parseLink } from "~/lib/links";
import {
  hashFile,
  requestLinkTask,
  requestUploadUrl,
  uploadFileToR2,
  triggerSeparation,
  pollStatus,
  fetchStemUrls,
  TrackNotFoundError,
  UserFacingError,
} from "~/lib/api";

/** Shortest time the "Get song" step stays lit. */
const MIN_LOOKUP_MS = 1000;

// Said in the product's voice: what happened, then what to do.
const EXPIRED_ERROR = "That song has expired. Drop it again to split it.";
const OPEN_ERROR = "That song didn’t load. Check your connection.";

// A "Try again" button follows these, so they say what happened, not what
// to do about it.
function stageError(stage: Stage): string {
  switch (stage) {
    case "upload":
      return "The upload didn’t finish. Check your connection.";
    case "lookup":
      return "That link couldn’t be read. Check your connection.";
    case "start":
      return "The GPU didn’t start.";
    case "fetch":
      return "The song didn’t download.";
    case "separate":
      return "Separating the stems failed.";
    case "load":
      return "The stems are ready but didn’t load.";
  }
}

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

export function Home() {
  // Start the model download with the page instead of after three.js has
  // loaded and parsed. Same-origin fetch, so it matches useGLTF's request.
  preload(MODEL_URL, { as: "fetch", crossOrigin: "anonymous" });

  const audioEngine = useAudioEngine();
  const status = usePlayerStore((s) => s.status);
  const trackTitle = usePlayerStore((s) => s.trackTitle);
  const trackDate = usePlayerStore((s) => s.trackDate);
  const duration = usePlayerStore((s) => s.duration);
  const errorMessage = usePlayerStore((s) => s.errorMessage);
  const isOn = usePlayerStore((s) => s.isOn);
  const uploadStage = usePlayerStore((s) => s.stage);
  const matchedVideo = usePlayerStore((s) => s.matchedVideo);
  const canRetry = usePlayerStore((s) => s.canRetry);
  /** Runs the last split or load again, for the "Try again" button. */
  const retry = useRef<(() => void) | null>(null);

  useKeyboardShortcuts(audioEngine);

  /** Splits a song from a file or a link, then loads its stems. */
  const split = useCallback(
    async (input: { file: File } | { url: string }) => {
      retry.current = () => void split(input);
      // The link field only submits links it could read, so there's a provider.
      const source: Source =
        "file" in input ? "file" : (parseLink(input.url)?.provider ?? "youtube");
      const store = usePlayerStore.getState();
      store.reset();
      store.setSource(source);
      // A link's title comes from its site; until then, the steps stand alone.
      if ("file" in input) store.setTrackTitle(titleFromFilename(input.file.name));
      store.setTrackDate(Date.now());
      let stage: Stage = source === "file" ? "upload" : "lookup";
      const enter = (next: Stage) => {
        stage = next;
        store.setStage(next);
        store.setProcessingProgress(0);
      };

      /** Starts the GPU job (unless `started` already has) and waits for it,
       *  lighting each step as it goes. */
      const separate = async (taskId: string, started = triggerSeparation(taskId)) => {
        enter("start");
        store.setStatus("processing");
        await started;

        try {
          await pollStatus(taskId, (progress) => {
            // The job's first progress report means the GPU is up and working.
            // For a link it then fetches the song, done when it reports 15.
            const now = usePlayerStore.getState().stage;
            if (progress > 0 && now === "start") enter(source === "file" ? "separate" : "fetch");
            if (progress >= 15 && usePlayerStore.getState().stage === "fetch") enter("separate");
            store.setProcessingProgress(progress);
          });
        } catch (err) {
          // A link the job can't fetch can fail before polling sees the GPU
          // report in. The song is the problem, so blame the fetch step.
          const stuck = usePlayerStore.getState().stage === "start";
          if (source !== "file" && err instanceof UserFacingError && stuck) enter("fetch");
          throw err;
        }
      };

      try {
        enter(stage);
        let taskId: string;

        if ("file" in input) {
          store.setStatus("uploading");
          // A failed hash only costs the cache hit, never the upload.
          const hash = await hashFile(input.file).catch(() => null);
          const ticket = await requestUploadUrl(input.file, hash);
          taskId = ticket.taskId;
          store.setTaskId(taskId);

          // Split before: its stems are already there, so skip straight to loading.
          if ("uploadUrl" in ticket) {
            await uploadFileToR2(ticket.uploadUrl, input.file, (progress) => {
              store.setProcessingProgress(progress);
            });
            await separate(taskId);
          } else {
            store.setStatus("processing");
          }
        } else {
          store.setStatus("processing");
          // The lookup is usually instant, which flashed the step past unread.
          // Hold it long enough to see; a slow lookup isn't held any longer.
          // Only the step is held: the job starts as soon as there's a task.
          const shown = new Promise((r) => setTimeout(r, MIN_LOOKUP_MS));
          const ticket = await requestLinkTask(input.url);
          taskId = ticket.taskId;
          store.setTaskId(taskId);
          if (!("cached" in ticket)) {
            if (ticket.title) store.setTrackTitle(ticket.title);
            const started = triggerSeparation(taskId);
            started.catch(() => {}); // reported by separate, after the hold
            await shown;
            await separate(taskId, started);
          } else {
            await shown;
          }
        }

        // Set before loading, so a reload retries the load and not the GPU run.
        enter("load");
        setTrackParam(taskId);
        const { stems, gains, title, createdAt, matchedVideo: video } = await fetchStemUrls(taskId);
        // A file keeps the name it was dropped with, even on a cache hit from
        // someone else's upload. A link's title is the same for everyone.
        if (source !== "file") store.setTrackTitle(title);
        store.setMatchedVideo(video);
        await audioEngine?.loadStems(stems, gains);
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
        // The message on screen is per stage; this says what actually broke.
        console.error(`Failed at the ${stage} step`, err);
        store.setStatus("error");
        store.setErrorMessage(err instanceof UserFacingError ? err.message : stageError(stage));
        // A song that's too long or private would only fail the same way.
        store.setCanRetry(!(err instanceof UserFacingError) || err.retryable);
      }
    },
    [audioEngine],
  );

  const handleFileSelected = useCallback((file: File) => void split({ file }), [split]);
  const handleLinkSubmitted = useCallback((url: string) => void split({ url }), [split]);

  /** Loads a song that was split before, from a link, a reload or history. */
  const openTrack = useCallback(
    async (taskId: string, knownTitle?: string) => {
      if (!audioEngine) return;
      retry.current = () => void openTrack(taskId, knownTitle);
      const store = usePlayerStore.getState();
      store.reset();
      store.setTaskId(taskId);
      // No stage: it's one quick load, not the upload's multi-step run, so the
      // title and a "Loading" line stand in for the steps.
      if (knownTitle) store.setTrackTitle(knownTitle);
      store.setStatus("processing");
      setTrackParam(taskId);

      try {
        const { stems, gains, title, createdAt, matchedVideo: video } = await fetchStemUrls(taskId);
        await audioEngine.loadStems(stems, gains);
        store.setDuration(audioEngine.duration);
        store.setTrackTitle(knownTitle ?? title);
        store.setMatchedVideo(video);
        store.setTrackDate(createdAt);
        remember(taskId);
        // No autoplay: the browser wants a gesture before audio starts.
        store.setStatus("ready");
      } catch (err) {
        console.error("Failed to open the song", err);
        // Only a missing task is gone for good; a dropped connection isn't.
        const expired = err instanceof TrackNotFoundError;
        if (expired) forgetTrack(taskId);
        setTrackParam(null);
        store.reset();
        store.setStatus("error");
        store.setErrorMessage(expired ? EXPIRED_ERROR : OPEN_ERROR);
        store.setCanRetry(!expired);
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

  // The first song's request goes through a server that sleeps when idle.
  // Waking it now means it's up by the time a song is picked.
  useEffect(() => {
    void fetch("/api/wake", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    document.title =
      trackTitle && status === "ready" ? `${trackTitle} – Stem Player` : "Stem Player";
  }, [trackTitle, status]);

  const handleNewTrack = useCallback(() => {
    audioEngine?.dispose();
    usePlayerStore.getState().reset();
    setTrackParam(null);
  }, [audioEngine]);

  const turnOn = useCallback(() => setPower(audioEngine, true), [audioEngine]);

  const busy = status === "uploading" || status === "processing";
  // Reopening a split song is one quick load with no steps to show.
  const reopening = busy && !uploadStage;
  const hasTrack = Boolean(trackTitle) && status !== "idle";

  // The song's title and details. On phones it sits above the device, so a
  // loaded song's name isn't pushed below the fold by the device and its
  // sliders; on wide screens it heads the controls column. One element,
  // placed by the grid below.
  const trackHeading = hasTrack && (
    // Centred and larger on phones, where it heads the page above the
    // device; left-aligned at the head of the controls on wide screens.
    <div className="flex flex-col items-center gap-1.5 text-center lg:items-start lg:text-left">
      <p className="line-clamp-3 text-headline text-balance wrap-break-word text-ink lg:text-display">
        {trackTitle}
      </p>
      {status === "ready" ? (
        <>
          <p className="text-caption text-ink-muted tabular-nums">
            {trackDetails(duration, trackDate)}
          </p>
          {/* Spotify and Apple Music songs are found on YouTube by
              search, so name the video: a wrong match is then obvious. */}
          {matchedVideo && (
            <p className="line-clamp-2 text-caption text-ink-muted">
              Audio from{" "}
              <a
                href={`https://www.youtube.com/watch?v=${matchedVideo.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-ink underline underline-offset-4 hover:text-ink-muted"
              >
                {matchedVideo.title || (
                  <>
                    this <span translate="no">YouTube</span> video
                  </>
                )}
              </a>
            </p>
          )}
        </>
      ) : (
        // An upload's steps say what's happening; a reopened song has
        // none, so it gets the device's loading mark instead.
        reopening && <LoadingStems className="mt-2.5" />
      )}
    </div>
  );

  return (
    <main className="relative z-10 flex min-h-screen flex-col items-center px-4 pt-5 pb-8 sm:pt-6 sm:pb-12 lg:px-10 lg:pt-8">
      {/* Past the device's sliders and swatches, straight to the song and
          its controls. Shown only while focused. */}
      <a
        href="#controls"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-body focus:text-page"
      >
        Skip to controls
      </a>
      {/* A small mark in the top-left corner on phones, so the song's title
          below is what heads the page; full size on wide screens. */}
      <header className="flex w-full max-w-6xl justify-start">
        {/* The product's own logotype, so the one place type is set in caps. */}
        <h1
          translate="no"
          className="flex items-center gap-2 text-wordmark-compact text-ink uppercase lg:gap-3 lg:text-wordmark"
        >
          <DeviceIcon className="h-5 w-auto lg:h-7" />
          Stem Player
        </h1>
      </header>

      {/* Stacked on phones; on wide screens the device takes the left and the
          controls sit beside it, the pair centred in the window with their
          tops level (the device's box starts at the device itself). A song's
          title comes first in the source, so on phones it sits above the
          device; on wide screens the grid puts it at the head of the right
          column, with the device spanning both rows. The second row flexes,
          so the tall device can't open a gap under the title. */}
      <div
        className={`flex w-full flex-1 flex-col items-center lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:content-center lg:items-start lg:gap-x-16 lg:gap-y-5 ${trackHeading ? "lg:grid-rows-[auto_1fr]" : ""}`}
      >
        {trackHeading && (
          <div className="relative z-10 mt-10 w-full max-w-sm lg:col-start-2 lg:row-start-1 lg:mt-0 lg:max-w-none">
            {trackHeading}
          </div>
        )}
        {/* The device's box starts at the device, so it needs its own air
            below the wordmark when stacked. */}
        <div
          className={`flex w-full flex-col items-center lg:col-start-1 lg:row-start-1 lg:mt-0 ${trackHeading ? "mt-4 lg:row-span-2" : "mt-12"}`}
        >
          <Device audioEngine={audioEngine} />
          {/* Under the device it recolours, out of the way while the steps show. */}
          {!busy && (
            <div className="panel-in relative z-10 mt-8">
              <ColorPicker />
            </div>
          )}
        </div>

        {/* Stacked above the 3D canvas, which overflows down into this space. */}
        {/* Left-aligned at every width, so the title, lists and form share
            one edge. */}
        <div
          id="controls"
          tabIndex={-1}
          className={`relative z-10 mt-8 flex w-full max-w-sm flex-col gap-5 outline-none lg:col-start-2 lg:mt-0 lg:max-w-none ${trackHeading ? "lg:row-start-2" : "lg:row-start-1"}`}
        >
          {/* With a song, its title heads the column from the grid above. */}
          {hasTrack ? null : reopening ? (
            // A song opened from its link: no title until the stems arrive.
            <LoadingStems />
          ) : busy ? (
            <p className="text-body text-ink-muted">Loading your song…</p>
          ) : (
            <h2 className="text-display text-balance text-ink">
              Split any song into vocals, drums, bass and everything else.
            </h2>
          )}

          {status === "ready" && !isOn && (
            <p className="text-body text-ink-muted">
              The device is off. Hold its centre button for a second, or{" "}
              <button
                type="button"
                onClick={turnOn}
                className="text-ink underline underline-offset-4 hover:text-ink-muted"
              >
                turn it on
              </button>
              .
            </p>
          )}

          <TransportBar audioEngine={audioEngine} />
          {/* Plain rows under the transport, lined up on the same label column
              as the effect sliders below. */}
          {status === "ready" && (
            <div className="panel-in flex w-full flex-col gap-3">
              <MasterVolume audioEngine={audioEngine} />
              <SpeedControl audioEngine={audioEngine} />
            </div>
          )}
          <EffectsPanel audioEngine={audioEngine} />
          <ProcessingSteps />

          {status === "error" && errorMessage && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-body text-balance text-magenta-ink">
                {errorMessage}
              </p>
              {/* A failure is a fork: run it again, or go back for another
                  song. The form and history wait behind the second. */}
              <div className="flex flex-wrap items-center gap-3">
                {canRetry && (
                  <button
                    type="button"
                    onClick={() => retry.current?.()}
                    className="btn-primary px-6"
                  >
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleNewTrack}
                  className={canRetry ? "btn-secondary" : "btn-primary px-6"}
                >
                  Choose another song
                </button>
              </div>
            </div>
          )}

          <UploadZone onFileSelected={handleFileSelected} onLinkSubmitted={handleLinkSubmitted} />
          {status === "idle" && (
            <HistoryList onOpen={(entry) => void openTrack(entry.taskId, entry.title)} />
          )}

          {status === "ready" && (
            <footer className="mt-4 flex w-full flex-wrap items-center gap-x-3 gap-y-5">
              <button type="button" onClick={handleNewTrack} className="btn-secondary">
                Load another song
              </button>
              <PowerButton audioEngine={audioEngine} />
              <KeyboardShortcuts />
            </footer>
          )}
        </div>
      </div>
    </main>
  );
}

/** A reopened song's one quick load, in the device loader's LED dots. */
function LoadingStems({ className = "" }: { className?: string }) {
  return (
    <p role="status" className={`flex items-center gap-3 text-caption text-ink-muted ${className}`}>
      <LedDots />
      Loading stems…
    </p>
  );
}
