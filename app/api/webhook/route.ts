import { env } from "cloudflare:workers";
import { updateJob } from "~/lib/jobs.server";
import { STEMS } from "~/lib/constants";
import { secretMatches } from "~/lib/utils/secret";
import { SHA256, linkCacheKey, stemCacheKey } from "~/lib/stem-cache";
import type { Provider } from "~/lib/links";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const STEM_NAMES = new Set(Object.keys(STEMS));

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-webhook-secret"), env.WEBHOOK_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    task_id,
    status,
    progress,
    stems,
    error,
    user_error,
    retryable,
    title,
    matched_youtube_id,
    matched_title,
    input_sha256,
    stem_gains,
  } = (await request.json()) as {
    task_id: string;
    status: string;
    progress?: number;
    stems?: Record<string, string>;
    error?: string;
    /** Why it failed, worded for the person, when it was the song and not
     *  the system: a video too long, private or blocked. */
    user_error?: string;
    /** Whether trying the same song again might work, for a user_error. */
    retryable?: boolean;
    /** The fetched song's title, for when the link lookup couldn't give one. */
    title?: string;
    /** For a Spotify or Apple Music song, the YouTube video found for it. */
    matched_youtube_id?: string;
    matched_title?: string;
    /** Hash of the audio the job downloaded, for recognising re-uploads. */
    input_sha256?: string;
    /** What each stem was stored at, which the player undoes. */
    stem_gains?: Record<string, number>;
  };

  const matchedId =
    matched_youtube_id && YOUTUBE_ID.test(matched_youtube_id) ? matched_youtube_id : null;
  const done = status === "ready" || status === "error";
  // Only sane gains for known stems: the player divides by them.
  const stemGains =
    stem_gains &&
    Object.fromEntries(
      Object.entries(stem_gains).filter(
        ([name, gain]) => STEM_NAMES.has(name) && typeof gain === "number" && gain > 0 && gain <= 1,
      ),
    );

  let ignored = false;
  const existing = await updateJob<{
    status: string;
    title?: string;
    link?: { provider: Provider; id: string };
  }>(task_id, (job) => {
    // Progress posts can land after the final one; never step back from done.
    ignored = job.status === "ready" || job.status === "error";
    if (ignored) return null;
    return {
      ...job,
      status,
      ...(progress !== undefined && { progress }),
      ...(stems && { stems }),
      ...(error && { error }),
      ...(user_error && { userError: user_error.slice(0, 300) }),
      ...(retryable === true && { retryable: true }),
      ...(title && !job.title && { title: title.slice(0, 200) }),
      ...(matchedId && {
        matchedVideo: { id: matchedId, title: (matched_title ?? "").slice(0, 200) },
      }),
      ...(stemGains && { stemGains }),
      ...(done && { completedAt: Date.now() }),
    };
  });
  if (!existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (ignored) {
    return Response.json({ ok: true, ignored: true });
  }

  // Expires with the job, since the stems it points at go at the same time.
  if (status === "ready" && input_sha256 && SHA256.test(input_sha256)) {
    await env.JOBS.put(stemCacheKey(input_sha256), task_id, { expirationTtl: 86400 * 14 });
  }
  // The link it came from, and for a matched song the video it was found as,
  // so pasting either again reuses these stems.
  if (status === "ready" && existing.link) {
    const { provider, id } = existing.link;
    await env.JOBS.put(linkCacheKey(provider, id), task_id, { expirationTtl: 86400 * 14 });
  }
  if (status === "ready" && matchedId) {
    await env.JOBS.put(linkCacheKey("youtube", matchedId), task_id, { expirationTtl: 86400 * 14 });
  }

  return Response.json({ ok: true });
}
