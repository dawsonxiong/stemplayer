import { usePlayerStore } from "~/lib/store";

export function UploadProgress() {
  const status = usePlayerStore((s) => s.status);
  const progress = usePlayerStore((s) => s.processingProgress);

  if (status !== "uploading") return null;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2 px-4">
      <div
        className="h-1 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${progress}%`,
            backgroundColor: "var(--color-stem-vocals)",
          }}
        />
      </div>
      <span className="text-xs text-[var(--color-text-secondary)]">
        Uploading{progress > 0 ? ` ${Math.round(progress)}%` : "..."}
      </span>
    </div>
  );
}
