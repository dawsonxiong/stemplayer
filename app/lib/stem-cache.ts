/** Recognising a song that was split before, by the SHA-256 of its bytes or
 *  by the link it came from. */
import { AUTO_DELETE_DAYS } from "./constants";
import type { Provider } from "./links";
import { getJob } from "./jobs.server";
import { generatePresignedUrl } from "./utils/presigned";

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
 *  files were removed early still reads as ready. Asks over the S3 API, like
 *  the browser does, because in dev the AUDIO_BUCKET binding is a local copy
 *  that Modal never writes to. Throws if R2 doesn't answer. */
async function stemsExist(env: Env, stems: Record<string, string>): Promise<boolean> {
  const found = await Promise.all(
    Object.values(stems).map(async (key) => {
      const url = await generatePresignedUrl({ env, key, method: "HEAD", expiresIn: 60 });
      const res = await fetch(url, { method: "HEAD" });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`R2 HEAD ${key} failed (${res.status})`);
      return true;
    }),
  );
  return found.length > 0 && found.every(Boolean);
}

/** The finished task an index key points at, if its stems are still fresh. */
export async function findCachedTask(env: Env, indexKey: string): Promise<string | null> {
  const taskId = await env.JOBS.get(indexKey);
  if (!taskId) return null;
  const job = await getJob<{
    status: string;
    createdAt: number;
    stems?: Record<string, string>;
  }>(taskId);
  if (job?.status !== "ready" || !job.stems) return null;
  if (!(Date.now() - job.createdAt < CACHE_MAX_AGE_MS)) return null;

  // Otherwise every later try of this song gets the same missing files.
  try {
    if (await stemsExist(env, job.stems)) return taskId;
  } catch (err) {
    // A cache check that can't finish is a miss, not a failed upload.
    console.error("Stem cache check failed", err);
    return null;
  }
  // Gone for good, so stop pointing at them. The next split writes it again.
  await env.JOBS.delete(indexKey);
  return null;
}
