import { POLL_INTERVAL_MS, POLL_MAX_INTERVAL_MS, POLL_TIMEOUT_MS } from "./constants";

/** An error whose message is written for the person using the app (a size
 *  limit, the hourly cap) rather than for a developer. */
export class UserFacingError extends Error {}

/** Client errors carry a message meant for the user; server errors do not. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status < 500 && body.error) return new UserFacingError(body.error);
  return new Error(body.error || `${fallback} (${res.status})`);
}

export async function requestUploadUrl(file: File) {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      fileSize: file.size,
    }),
  });
  if (!res.ok) throw await failure(res, "Upload request failed");
  return res.json() as Promise<{ taskId: string; uploadUrl: string }>;
}

export async function uploadFileToR2(
  uploadUrl: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const xhr = new XMLHttpRequest();

  await new Promise<void>((resolve, reject) => {
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress((e.loaded / e.total) * 100);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

export async function triggerSeparation(taskId: string) {
  const res = await fetch("/api/separate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId }),
  });
  if (!res.ok) throw await failure(res, "Failed to start separation");
  return res.json();
}

interface JobStatus {
  status: "uploaded" | "processing" | "ready" | "error";
  progress?: number;
  error?: string;
  stems?: Record<string, string>;
}

export async function pollStatus(
  taskId: string,
  onProgress?: (progress: number) => void,
): Promise<JobStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let interval = POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval * 1.25, POLL_MAX_INTERVAL_MS);

    const res = await fetch(`/api/status/${taskId}`);
    // KV is eventually consistent: a fresh key can 404 for a moment.
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Status check failed (${res.status})`);
    const data = (await res.json()) as JobStatus;

    if (data.status === "ready") return data;
    if (data.status === "error") {
      throw new Error(data.error || "Separation failed");
    }
    if (typeof data.progress === "number") onProgress?.(data.progress);
  }

  throw new UserFacingError("Separating took too long. Try a shorter song.");
}

export async function fetchStemUrls(taskId: string) {
  const res = await fetch(`/api/stems/${taskId}`);
  if (!res.ok) {
    throw new Error("Failed to fetch stem URLs");
  }
  return res.json() as Promise<{
    stems: Record<string, string>;
    title: string;
    createdAt: number | null;
  }>;
}
