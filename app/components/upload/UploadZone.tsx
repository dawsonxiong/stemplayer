import { useCallback, useEffect, useId, useRef, useState } from "react";
import { hashFile, warmGpu } from "~/lib/api";
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
  // A song waits here until Split is pressed: one chosen file, or the link.
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The latest file picked, so one still being checked when another song is
  // picked doesn't land over it.
  const picked = useRef<File | null>(null);
  const errorId = useId();

  /** A link replaces a chosen file; there's only ever one song waiting. */
  const stageLink = useCallback((url: string) => {
    picked.current = null;
    setError(null);
    setLink(url);
    if (url.trim()) setFile(null);
    // A GPU takes seconds to start: start one while Split is still to press.
    // Not for an album or playlist, which Split turns away.
    const parsed = parseLink(url.trim());
    if (parsed && parsed.kind !== "collection") warmGpu();
  }, []);

  const split = useCallback(() => {
    if (file) {
      setFile(null);
      onFileSelected(file);
      return;
    }
    const url = link.trim();
    if (!url) return;
    setError(null);
    const parsed = parseLink(url);
    if (!parsed || parsed.kind === "collection") {
      setError(parsed ? COLLECTION_LINK : UNSUPPORTED_LINK);
      return;
    }
    setLink("");
    onLinkSubmitted(url);
  }, [file, link, onFileSelected, onLinkSubmitted]);

  const stageFile = useCallback(async (chosen: File) => {
    picked.current = chosen;
    setError(null);

    if (
      !ACCEPTED_FORMATS.includes(chosen.type) &&
      !chosen.name.match(/\.(mp3|wav|flac|ogg|aac|m4a)$/i)
    ) {
      setError("That file isn’t a supported format. Choose an MP3, WAV, FLAC, OGG, AAC or M4A.");
      return;
    }

    if (chosen.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(
        `That file is over ${MAX_FILE_SIZE_MB}MB. Choose a smaller file or a compressed format like MP3.`,
      );
      return;
    }

    try {
      const duration = await getAudioDuration(chosen);
      if (picked.current !== chosen) return;
      if (duration > MAX_DURATION_MINUTES * 60) {
        setError(
          `That song is over ${MAX_DURATION_MINUTES} minutes. Trim it or choose a shorter one.`,
        );
        return;
      }
    } catch {
      // Let the server handle it
    }

    if (picked.current !== chosen) return;
    setFile(chosen);
    setLink("");
    warmGpu();
    void hashFile(chosen);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      if (picked) stageFile(picked);
      e.target.value = "";
    },
    [stageFile],
  );

  // A failed split offers its own way back here, so the form waits for idle.
  const accepting = status === "idle";

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
      const dropped = e.dataTransfer?.files[0];
      if (dropped) stageFile(dropped);
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
  }, [accepting, stageFile]);

  // Like a dropped file, a song link pasted anywhere on the page is taken,
  // not only one pasted into the field. Pastes into other fields are theirs.
  useEffect(() => {
    if (!accepting) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const text = e.clipboardData?.getData("text/plain").trim() ?? "";
      if (!parseLink(text)) return;
      e.preventDefault();
      stageLink(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accepting, stageLink]);

  if (!accepting) return null;

  const chooseFile = () => inputRef.current?.click();

  return (
    // Choosing, dropping or pasting only picks the song; Split starts it.
    // Full width on phones; on wide screens Split sits on the link's line.
    <form
      className="panel-in flex w-full flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        split();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.aac,.m4a"
        className="hidden"
        onChange={handleChange}
      />
      {file ? (
        <div className="flex w-full items-center rounded-full border border-line-strong text-body text-ink lg:w-auto lg:max-w-full lg:self-start">
          <button
            type="button"
            onClick={chooseFile}
            aria-label={`${file.name}. Choose a different song`}
            title="Choose a different song"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-l-full py-2.5 pr-2 pl-5 transition-colors hover:text-ink-muted"
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
              className="shrink-0"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <span className="truncate">{file.name}</span>
          </button>
          <button
            type="button"
            onClick={() => setFile(null)}
            aria-label={`Remove ${file.name}`}
            className="mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`btn-secondary w-full cursor-pointer justify-center lg:w-auto lg:self-start ${isDragOver ? "border-cyan-ink text-cyan-ink" : ""}`}
          onClick={chooseFile}
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
          {isDragOver ? "Drop to choose it" : "Choose a song"}
        </button>
      )}

      {/* In source order the hint follows the field it's about; on wide
          screens the grid lifts Split up beside the field. */}
      <div className="grid w-full gap-y-1.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-3">
        {/* One song at a time: once a file is chosen the link field steps
            aside, and the chip's × brings it back. */}
        {!file && (
          <div className="link-field flex w-full rounded-full border border-line px-4 transition-colors focus-within:border-line-strong lg:col-start-1 lg:row-start-1">
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={link}
              onChange={(e) => stageLink(e.target.value)}
              placeholder="or paste a song link…"
              aria-label="Song link from YouTube, SoundCloud, Spotify or Apple Music"
              aria-describedby={error ? errorId : undefined}
              className="min-w-0 flex-1 bg-transparent py-2.5 text-body text-ink placeholder:text-ink-muted"
            />
          </div>
        )}
        {/* An error takes the hint's place, right under what it's about. Each
            link error names the sites itself, so the hint isn't missed. */}
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="text-caption text-balance text-magenta-ink lg:col-span-2 lg:row-start-2"
          >
            {error}
          </p>
        ) : (
          !file && (
            <p
              aria-hidden="true"
              translate="no"
              className="text-caption text-ink-muted lg:col-span-2 lg:row-start-2"
            >
              YouTube, SoundCloud, Spotify or Apple Music
            </p>
          )
        )}
        <button
          type="submit"
          disabled={!file && !link.trim()}
          className={`btn-primary mt-1.5 w-full cursor-pointer justify-center px-6 disabled:cursor-not-allowed disabled:opacity-40 lg:mt-0 lg:w-auto lg:row-start-1 ${file ? "lg:col-start-1 lg:justify-self-start" : "lg:col-start-2"}`}
        >
          Split
        </button>
      </div>
    </form>
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
