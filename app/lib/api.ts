import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./constants";

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
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || "Upload request failed");
  }
  return res.json() as Promise<{ taskId: string; uploadUrl: string }>;
}

export async function uploadFileToR2(
  uploadUrl: string,
  file: File,
  onProgress?: (progress: number) => void
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
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error || "Failed to start separation");
  }
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
  onProgress?: (progress: number) => void
): Promise<JobStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`/api/status/${taskId}`);
    const data = (await res.json()) as JobStatus;

    if (data.status === "ready") return data;
    if (data.status === "error") {
      throw new Error(data.error || "Separation failed");
    }
    if (typeof data.progress === "number") onProgress?.(data.progress);
  }

  throw new Error("Separation timed out. Try a shorter track.");
}

export async function fetchStemUrls(taskId: string) {
  const res = await fetch(`/api/stems/${taskId}`);
  if (!res.ok) {
    throw new Error("Failed to fetch stem URLs");
  }
  return res.json() as Promise<{
    stems: Record<string, string>;
    title: string;
  }>;
}
