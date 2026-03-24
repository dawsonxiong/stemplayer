import { useCallback, useRef, useState } from "react";
import { usePlayerStore } from "~/lib/store";
import {
  MAX_FILE_SIZE_MB,
  MAX_DURATION_MINUTES,
  ACCEPTED_FORMATS,
} from "~/lib/constants";

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
}

export function UploadZone({ onFileSelected }: UploadZoneProps) {
  const status = usePlayerStore((s) => s.status);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSubmit = useCallback(
    async (file: File) => {
      setError(null);

      if (
        !ACCEPTED_FORMATS.includes(file.type) &&
        !file.name.match(/\.(mp3|wav|flac|ogg|aac|m4a)$/i)
      ) {
        setError("Unsupported format. Use MP3, WAV, FLAC, OGG, AAC, or M4A.");
        return;
      }

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
        return;
      }

      try {
        const duration = await getAudioDuration(file);
        if (duration > MAX_DURATION_MINUTES * 60) {
          setError(
            `Track too long. Maximum duration is ${MAX_DURATION_MINUTES} minutes.`
          );
          return;
        }
      } catch {
        // Let the server handle it
      }

      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) validateAndSubmit(file);
    },
    [validateAndSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) validateAndSubmit(file);
      e.target.value = "";
    },
    [validateAndSubmit]
  );

  if (status !== "idle" && status !== "error") return null;

  return (
    <div className="w-full">
      <div
        className="relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl py-6 transition-all"
        style={{
          backgroundColor: isDragOver
            ? "rgba(245,166,35,0.05)"
            : "var(--color-bg-secondary)",
          border: `1px solid ${isDragOver ? "var(--color-stem-vocals)" : "var(--color-border)"}`,
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleChange}
        />

        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="mb-1 text-[var(--color-text-muted)]"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>

        <span className="text-sm text-[var(--color-text-secondary)]">
          Drop a track or click to upload
        </span>

        <span className="text-[10px] text-[var(--color-text-muted)]">
          MP3, WAV, FLAC, OGG, AAC — up to {MAX_FILE_SIZE_MB}MB
        </span>
      </div>

      {error && (
        <p className="mt-2 text-center text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.addEventListener(
      "loadedmetadata",
      () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      },
      { once: true }
    );
    audio.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read audio metadata"));
      },
      { once: true }
    );
  });
}
