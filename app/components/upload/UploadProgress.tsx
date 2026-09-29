import { usePlayerStore } from "~/lib/store";

export function UploadProgress() {
  const status = usePlayerStore((s) => s.status);
  const progress = usePlayerStore((s) => s.processingProgress);

  if (status !== "uploading") return null;

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div
        role="progressbar"
        aria-label="Upload"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        className="h-1 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--color-well)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${progress}%`,
            backgroundColor: "var(--color-text-primary)",
          }}
        />
      </div>
      <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">
        {progress > 0 ? `${Math.round(progress)}% uploaded` : "Starting upload"}
      </span>
    </div>
  );
}
