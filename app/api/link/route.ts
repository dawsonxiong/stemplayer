import type { Route } from "./+types/api.link";
import { findCachedTask, youTubeCacheKey } from "~/lib/stem-cache";
import { parseYouTubeId, youTubeWatchUrl } from "~/lib/youtube";

const NOT_A_VIDEO = "That isn’t a link to a YouTube video. Copy the link from the video’s page.";
const NO_SUCH_VIDEO = "That video doesn’t exist or was taken down. Check the link.";

/** Starts a task for a YouTube video. Nothing is uploaded: the separation job
 *  downloads the audio itself, so the client goes straight to /api/separate. */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { url } = (await request.json()) as { url?: string };

  const videoId = typeof url === "string" ? parseYouTubeId(url) : null;
  if (!videoId) return Response.json({ error: NOT_A_VIDEO }, { status: 400 });

  // The same video split before: no download and no GPU run.
  const cachedId = await findCachedTask(env, youTubeCacheKey(videoId));
  if (cachedId) return Response.json({ taskId: cachedId, cached: true });

  // oEmbed gives the title up front, so it shows while the stems are made, and
  // catches a mistyped ID before it costs a GPU start. A private or
  // unembeddable video answers 401 or 403; the job's download decides those.
  let title: string | null = null;
  const oembed = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youTubeWatchUrl(videoId))}`,
  ).catch(() => null);
  if (oembed?.status === 400 || oembed?.status === 404) {
    return Response.json({ error: NO_SUCH_VIDEO }, { status: 400 });
  }
  if (oembed?.ok) {
    const data = (await oembed.json().catch(() => ({}))) as { title?: unknown };
    if (typeof data.title === "string" && data.title.trim())
      title = data.title.trim().slice(0, 200);
  }

  const taskId = crypto.randomUUID();
  await env.JOBS.put(
    taskId,
    JSON.stringify({
      status: "uploaded",
      youtubeId: videoId,
      ...(title && { title }),
      createdAt: Date.now(),
    }),
    { expirationTtl: 86400 * 14 },
  );

  return Response.json({ taskId, title });
}
