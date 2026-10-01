/** Recognising a song that was split before, by the SHA-256 of its bytes or
 *  by the link it came from. */
import { AUTO_DELETE_DAYS } from "./constants";
import type { Provider } from "./links";

export const SHA256 = /^[0-9a-f]{64}$/;

// Names what produced the stems. Bump it whenever modal/app.py changes the
// model or output format, so old results stop being served for new uploads.
const OUTPUT_VERSION = "htdemucs-mp3-192";

// A hit this close to deletion would vanish almost at once, so split again.
const CACHE_MAX_AGE_MS = (AUTO_DELETE_DAYS - 2) * 86_400_000;

export const stemCacheKey = (hash: string) => `hash:${OUTPUT_VERSION}:${hash}`;
export const linkCacheKey = (provider: Provider, id: string) =>
  `link:${OUTPUT_VERSION}:${provider}:${id}`;

/** Whether every stem file is still in R2. KV can outlive them: a job whose
 *  files were removed early still reads as ready. */
export async function stemsExist(env: Env, stems: Record<string, string>): Promise<boolean> {
  const found = await Promise.all(Object.values(stems).map((key) => env.AUDIO_BUCKET.head(key)));
  return found.length > 0 && found.every(Boolean);
}

/** The finished task an index key points at, if its stems are still fresh. */
export async function findCachedTask(env: Env, indexKey: string): Promise<string | null> {
  const taskId = await env.JOBS.get(indexKey);
  if (!taskId) return null;
  const job = await env.JOBS.get<{
    status: string;
    createdAt: number;
    stems?: Record<string, string>;
  }>(taskId, "json");
  if (job?.status !== "ready" || !job.stems) return null;
  if (!(Date.now() - job.createdAt < CACHE_MAX_AGE_MS)) return null;
  // Otherwise every later try of this song gets the same missing files.
  return (await stemsExist(env, job.stems)) ? taskId : null;
}
