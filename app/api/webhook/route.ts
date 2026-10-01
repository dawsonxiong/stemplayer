import { env } from "cloudflare:workers";
import { secretMatches } from "~/lib/utils/secret";
import { SHA256, linkCacheKey, stemCacheKey } from "~/lib/stem-cache";
import type { Provider } from "~/lib/links";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

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
  };

  const raw = await env.JOBS.get(task_id);
  if (!raw) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const existing = JSON.parse(raw) as {
    status: string;
    title?: string;
    link?: { provider: Provider; id: string };
  };
  const matchedId =
    matched_youtube_id && YOUTUBE_ID.test(matched_youtube_id) ? matched_youtube_id : null;
  const done = status === "ready" || status === "error";

  // Progress posts can land after the final one; never step back from done.
  if (existing.status === "ready" || existing.status === "error") {
    return Response.json({ ok: true, ignored: true });
  }

  await env.JOBS.put(
    task_id,
    JSON.stringify({
      ...existing,
      status,
      ...(progress !== undefined && { progress }),
      ...(stems && { stems }),
      ...(error && { error }),
      ...(user_error && { userError: user_error.slice(0, 300) }),
      ...(retryable === true && { retryable: true }),
      ...(title && !existing.title && { title: title.slice(0, 200) }),
      ...(matchedId && {
        matchedVideo: { id: matchedId, title: (matched_title ?? "").slice(0, 200) },
      }),
      ...(done && { completedAt: Date.now() }),
    }),
    { expirationTtl: 86400 * 14 },
  );

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
