import type { Route } from "./+types/home";
import { useCallback } from "react";
import { Device } from "~/components/device/Device";
import { TransportBar } from "~/components/transport/TransportBar";
import { UploadZone } from "~/components/upload/UploadZone";
import { UploadProgress } from "~/components/upload/UploadProgress";
import { useAudioEngine } from "~/hooks/useAudioEngine";
import { usePlayerStore } from "~/lib/store";
import {
  requestUploadUrl,
  uploadFileToR2,
  triggerSeparation,
  pollStatus,
  fetchStemUrls,
} from "~/lib/api";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stem Player" },
    {
      name: "description",
      content:
        "Upload any song, separate it into stems, and mix it live in your browser.",
    },
  ];
}

export default function Home() {
  const audioEngine = useAudioEngine();
  const status = usePlayerStore((s) => s.status);
  const trackTitle = usePlayerStore((s) => s.trackTitle);
  const errorMessage = usePlayerStore((s) => s.errorMessage);

  const handleFileSelected = useCallback(
    async (file: File) => {
      const store = usePlayerStore.getState();
      store.reset();
      store.setTrackTitle(file.name.replace(/\.[^.]+$/, ""));

      try {
        store.setStatus("uploading");
        const { taskId, uploadUrl } = await requestUploadUrl(file);
        store.setTaskId(taskId);

        await uploadFileToR2(uploadUrl, file, (progress) => {
          store.setProcessingProgress(progress);
        });

        store.setStatus("processing");
        store.setProcessingProgress(0);
        await triggerSeparation(taskId);

        await pollStatus(taskId, (progress) => {
          store.setProcessingProgress(progress);
        });

        const { stems } = await fetchStemUrls(taskId);
        await audioEngine?.loadStems(stems);

        store.setStatus("ready");
        audioEngine?.play();
        store.setPlaying(true);
      } catch (err) {
        store.setStatus("error");
        store.setErrorMessage(
          err instanceof Error ? err.message : "Something went wrong"
        );
      }
    },
    [audioEngine]
  );

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-8">
      {/* Header */}
      <header className="mb-2">
        {trackTitle && status === "ready" ? (
          <h1 className="max-w-md truncate text-center text-base font-medium tracking-wide text-[var(--color-text-primary)]">
            {trackTitle}
          </h1>
        ) : status === "uploading" ? (
          <h1 className="text-center text-sm text-[var(--color-text-secondary)]">
            Uploading...
          </h1>
        ) : status === "processing" ? (
          <h1 className="text-center text-sm text-[var(--color-text-secondary)]">
            Separating stems...
          </h1>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              Stem Player
            </h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              Upload a track to begin
            </p>
          </div>
        )}
      </header>

      {/* Device */}
      <Device audioEngine={audioEngine} />

      {/* Transport */}
      <div className="mt-2 w-full max-w-sm">
        <TransportBar audioEngine={audioEngine} />
      </div>

      {/* Upload progress */}
      <div className="mt-4 w-full max-w-sm">
        <UploadProgress />
      </div>

      {/* Upload zone */}
      <div className="mt-4 w-full max-w-sm">
        <UploadZone onFileSelected={handleFileSelected} />
      </div>

      {/* Error */}
      {status === "error" && errorMessage && (
        <div className="mt-4 w-full max-w-sm">
          <p className="rounded-lg bg-red-500/10 px-4 py-2 text-center text-sm text-red-400">
            {errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}
