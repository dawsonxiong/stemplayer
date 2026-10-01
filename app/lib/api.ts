import { POLL_INTERVAL_MS, POLL_MAX_INTERVAL_MS, POLL_TIMEOUT_MS } from "./constants";

/** An error whose message is written for the person using the app (a size
 *  limit, the hourly cap) rather than for a developer. Most are about the song
 *  and would only happen again, so trying again is offered only when
 *  `retryable` says it might go differently. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** The task, or its stems, no longer exist: expired, or never finished. */
export class TrackNotFoundError extends Error {}

/** Client errors carry a message meant for the user; server errors do not. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  // 424: a site the song was looked up on failed, which may pass.
  if (res.status < 500 && body.error) return new UserFacingError(body.error, res.status === 424);
  return new Error(body.error || `${fallback} (${res.status})`);
}

/** SHA-256 of the file's bytes, so a song split before is recognised. */
export async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Either a fresh task to upload into, or the finished task for the same song. */
export type UploadTicket = { taskId: string; uploadUrl: string } | { taskId: string; cached: true };

export async function requestUploadUrl(file: File, hash: string | null) {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      fileSize: file.size,
      hash,
    }),
  });
  if (!res.ok) throw await failure(res, "Upload request failed");
  return res.json() as Promise<UploadTicket>;
}

/** A task for a song link, or the finished task for the same song. Its title
 *  is null when the site wouldn't say; the job fills it in later. */
export type LinkTicket =
  | { taskId: string; title: string | null }
  | { taskId: string; cached: true };

export async function requestLinkTask(url: string) {
  const res = await fetch("/api/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw await failure(res, "Link request failed");
  return res.json() as Promise<LinkTicket>;
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
  userError?: string;
  retryable?: boolean;
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
      if (data.userError) throw new UserFacingError(data.userError, data.retryable === true);
      throw new Error(data.error || "Separation failed");
    }
    if (typeof data.progress === "number") onProgress?.(data.progress);
  }

  throw new UserFacingError("Separating took too long. Try a shorter song.");
}

export async function fetchStemUrls(taskId: string) {
  let res = await fetch(`/api/stems/${taskId}`);
  // 409: this read is behind the status poll that just saw "ready". KV
  // catches up within a minute or so.
  for (let wait = POLL_INTERVAL_MS; res.status === 409 && wait <= 16_000; wait *= 2) {
    await new Promise((r) => setTimeout(r, wait));
    res = await fetch(`/api/stems/${taskId}`);
  }
  if (res.status === 404) throw new TrackNotFoundError("Stems not found");
  if (!res.ok) throw new Error(`Failed to fetch stem URLs (${res.status})`);
  return res.json() as Promise<{
    stems: Record<string, string>;
    title: string;
    createdAt: number | null;
    /** For a Spotify or Apple Music song, the YouTube video it was found as. */
    matchedVideo: { id: string; title: string } | null;
  }>;
}
