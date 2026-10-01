import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePlayerStore } from "~/lib/store";
import { MAX_FILE_SIZE_MB, MAX_DURATION_MINUTES, ACCEPTED_FORMATS } from "~/lib/constants";
import { COLLECTION_LINK, parseLink, UNSUPPORTED_LINK } from "~/lib/links";

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  onLinkSubmitted: (url: string) => void;
}

export function UploadZone({ onFileSelected, onLinkSubmitted }: UploadZoneProps) {
  const status = usePlayerStore((s) => s.status);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const submitLink = useCallback(
    (url: string) => {
      setError(null);
      const parsed = parseLink(url);
      if (!parsed || parsed.kind === "collection") {
        setError(parsed ? COLLECTION_LINK : UNSUPPORTED_LINK);
        return;
      }
      setLink("");
      onLinkSubmitted(url);
    },
    [onLinkSubmitted],
  );

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

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) validateAndSubmit(file);
      e.target.value = "";
    },
    [validateAndSubmit],
  );

  const accepting = status === "idle" || status === "error";

  // The whole window is the drop target, so a song dropped on the device or
  // beside it counts too, not only one dropped on the button.
  useEffect(() => {
    if (!accepting) return;
    // dragenter and dragleave fire for every child crossed; count them so
    // moving over the page doesn't flicker the drop state off.
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setIsDragOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragOver(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) validateAndSubmit(file);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      setIsDragOver(false);
    };
  }, [accepting, validateAndSubmit]);

  // Like a dropped file, a song link pasted anywhere on the page counts,
  // not only one pasted into the field. Pastes into other fields are theirs.
  useEffect(() => {
    if (!accepting) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const text = e.clipboardData?.getData("text/plain").trim() ?? "";
      if (!parseLink(text)) return;
      e.preventDefault();
      submitLink(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accepting, submitLink]);

  if (!accepting) return null;

  return (
    <div className="panel-in flex w-full flex-col items-center gap-3 lg:items-start">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.aac,.m4a"
        className="hidden"
        onChange={handleChange}
      />
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <button
          type="button"
          className={`btn-primary cursor-pointer ${isDragOver ? "bg-cyan-ink" : ""}`}
          onClick={() => inputRef.current?.click()}
          aria-describedby={error ? errorId : undefined}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {isDragOver ? "Drop to split it" : "Choose a song"}
        </button>
        {/* Touch screens have no files to drag in. */}
        <span aria-hidden="true" className="hidden text-body text-ink-muted pointer-fine:inline">
          {isDragOver ? "anywhere on the page" : "or drop one anywhere"}
        </span>
      </div>

      <form
        className="link-field flex w-full max-w-sm items-center rounded-full border border-line pl-4 transition-colors focus-within:border-line-strong"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) submitLink(link.trim());
        }}
      >
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="or paste a song link"
          aria-label="Song link from YouTube, SoundCloud, Spotify or Apple Music"
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-body text-ink placeholder:text-ink-muted"
        />
        <button
          type="submit"
          className="shrink-0 cursor-pointer rounded-full px-4 py-2.5 text-body text-ink transition-colors hover:bg-raised"
        >
          Split
        </button>
      </form>
      <p aria-hidden="true" className="-mt-1 px-4 text-caption text-ink-muted">
        YouTube, SoundCloud, Spotify or Apple Music
      </p>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-center text-caption text-balance text-magenta-ink lg:text-left"
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
