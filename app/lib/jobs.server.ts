/** Job records: one JSON object per task, in R2 rather than KV.
 *
 *  KV caches a key at each Cloudflare location for up to a minute, and a
 *  job's updates come from the location nearest Modal while the person
 *  polls from theirs. Measured from Toronto against writes landing in Los
 *  Angeles, "ready" took 7–50 s to show (median ~28 s), longer than the
 *  separation itself. R2 reads see the latest write everywhere.
 *
 *  Kept beside the stems, so the bucket's 14-day `stems/` expiry clears the
 *  record with them. */
import { env } from "cloudflare:workers";

const key = (taskId: string) => `stems/${taskId}/job.json`;

// Every task ID is a crypto.randomUUID(). The ID comes from the URL or the
// request body, so anything else is junk: a '/' would reach outside the task's
// folder, and the KV fallback would read a cache index or rate-limit key.
export const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether jobs may stream their stems to the browser as they encode: the
 *  LIVE_PLAYBACK var, "on" or "off". */
export function liveEnabled(bindings: { LIVE_PLAYBACK?: string } = env): boolean {
  return bindings.LIVE_PLAYBACK === "on";
}

export async function getJob<T>(taskId: string): Promise<T | null> {
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) return null;
  const object = await env.AUDIO_BUCKET.get(key(taskId));
  if (object) return (await object.json()) as T;
  // Jobs from before records moved to R2, until they expire.
  return env.JOBS.get<T>(taskId, "json");
}

export async function putJob(taskId: string, job: object): Promise<void> {
  await env.AUDIO_BUCKET.put(key(taskId), JSON.stringify(job), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** Read, change and write a job, without losing a write that lands in
 *  between. A progress post that timed out on Modal's side can still be
 *  running when "ready" arrives; only one of them gets to write over what it
 *  read, and the other reads again. `change` returns null to leave the job
 *  as it is. Returns the job as read, or null if there's no such job. */
export async function updateJob<T extends object>(
  taskId: string,
  change: (job: T) => object | null,
): Promise<T | null> {
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const object = await env.AUDIO_BUCKET.get(key(taskId));
    const job = object ? ((await object.json()) as T) : await env.JOBS.get<T>(taskId, "json"); // from before R2, until they expire
    if (!job) return null;
    const next = change(job);
    if (!next) return job;
    const written = await env.AUDIO_BUCKET.put(key(taskId), JSON.stringify(next), {
      httpMetadata: { contentType: "application/json" },
      // A job only in KV has no R2 object yet: then there's nothing to race.
      ...(object && { onlyIf: { etagMatches: object.etag } }),
    });
    if (written) return job;
  }
  throw new Error(`Job ${taskId} kept changing under its update`);
}
