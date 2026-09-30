import { useCallback, useId, useRef, useState } from "react";
import { usePlayerStore } from "~/lib/store";
import { MAX_FILE_SIZE_MB, MAX_DURATION_MINUTES, ACCEPTED_FORMATS } from "~/lib/constants";

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
}

export function UploadZone({ onFileSelected }: UploadZoneProps) {
  const status = usePlayerStore((s) => s.status);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const validateAndSubmit = useCallback(
    async (file: File) => {
      setError(null);

      if (
        !ACCEPTED_FORMATS.includes(file.type) &&
        !file.name.match(/\.(mp3|wav|flac|ogg|aac|m4a)$/i)
      ) {
        setError("That file isn’t a supported format. Choose an MP3, WAV, FLAC, OGG, AAC or M4A.");
        return;
      }

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(
          `That file is over ${MAX_FILE_SIZE_MB}MB. Choose a smaller file or a compressed format like MP3.`,
        );
        return;
      }

      try {
        const duration = await getAudioDuration(file);
        if (duration > MAX_DURATION_MINUTES * 60) {
          setError(
            `That song is over ${MAX_DURATION_MINUTES} minutes. Trim it or choose a shorter one.`,
          );
          return;
        }
      } catch {
        // Let the server handle it
      }

      onFileSelected(file);
    },
    [onFileSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) validateAndSubmit(file);
    },
    [validateAndSubmit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) validateAndSubmit(file);
      e.target.value = "";
    },
    [validateAndSubmit],
  );

  if (status !== "idle" && status !== "error") return null;

  return (
    <div className="panel-in w-full">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.aac,.m4a"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        className="flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-6 transition-colors"
        style={{
          backgroundColor: isDragOver ? "var(--color-bg-primary)" : "var(--color-bg-secondary)",
          border: `1px ${isDragOver ? "solid var(--color-cyan-ink)" : "dashed rgba(0,0,0,0.22)"}`,
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        aria-describedby={error ? errorId : undefined}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="mb-1 text-[var(--color-text-secondary)]"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>

        <span className="text-sm text-[var(--color-text-primary)]">
          {isDragOver ? "Drop to split it into stems" : "Drop a song or choose a file"}
        </span>

        <span className="text-xs text-[var(--color-text-secondary)]">
          Up to {MAX_FILE_SIZE_MB}MB and {MAX_DURATION_MINUTES} minutes
        </span>
      </button>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 text-center text-xs text-[var(--color-magenta-ink)]"
        >
          {error}
        </p>
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
      { once: true },
    );
    audio.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read audio metadata"));
      },
      { once: true },
    );
  });
}
