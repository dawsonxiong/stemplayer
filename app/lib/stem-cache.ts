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

/** The finished task an index key points at, if its stems are still fresh. */
export async function findCachedTask(env: Env, indexKey: string): Promise<string | null> {
  const taskId = await env.JOBS.get(indexKey);
  if (!taskId) return null;
  const job = await env.JOBS.get<{ status: string; createdAt: number }>(taskId, "json");
  return job?.status === "ready" && Date.now() - job.createdAt < CACHE_MAX_AGE_MS ? taskId : null;
}
