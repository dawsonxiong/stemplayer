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
        // Upload
        store.setStatus("uploading");
        const { taskId, uploadUrl } = await requestUploadUrl(file);
        store.setTaskId(taskId);

        await uploadFileToR2(uploadUrl, file, (progress) => {
          store.setProcessingProgress(progress);
        });

        // Separate
        store.setStatus("processing");
        store.setProcessingProgress(0);
        await triggerSeparation(taskId);

        await pollStatus(taskId, (progress) => {
          store.setProcessingProgress(progress);
        });

        // Load stems
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      {/* Track title */}
      {trackTitle && status === "ready" && (
        <h1 className="max-w-md truncate text-center text-lg font-semibold text-[var(--color-text-primary)]">
          {trackTitle}
        </h1>
      )}

      {/* Logo / title when idle */}
      {(status === "idle" || status === "error") && (
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
          Stem Player
        </h1>
      )}

      {/* Device */}
      <Device audioEngine={audioEngine} />

      {/* Transport */}
      <TransportBar audioEngine={audioEngine} />

      {/* Upload progress */}
      <UploadProgress />

      {/* Upload zone */}
      <UploadZone onFileSelected={handleFileSelected} />

      {/* Error message */}
      {status === "error" && errorMessage && (
        <p className="max-w-md text-center text-sm text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
