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

export async function getJob<T>(taskId: string): Promise<T | null> {
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
