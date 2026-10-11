import { env } from "cloudflare:workers";
import { putJob } from "~/lib/jobs.server";
import { findCachedTask, linkCacheKey } from "~/lib/stem-cache";
import { warmGpu } from "~/lib/warm.server";
import { parseLink, UNSUPPORTED_LINK } from "~/lib/links";
import { LinkError, resolveLink, type ResolvedLink } from "~/lib/links.server";

const LOOKUP_FAILED = "That link couldn’t be read just now. Try again, or paste a YouTube link.";

/** Starts a task for a song link. Nothing is uploaded: the separation job
 *  fetches the audio itself, so the client goes straight to /api/separate. */
export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };

  const parsed = typeof url === "string" ? parseLink(url) : null;
  if (!parsed) return Response.json({ error: UNSUPPORTED_LINK }, { status: 400 });

  let link: ResolvedLink;
  try {
    link = await resolveLink(parsed);
  } catch (err) {
    if (err instanceof LinkError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Link lookup failed", err);
    // 424: the site we looked it up on failed, not this Worker. Below 500, so
    // the page shows this message rather than a generic one.
    return Response.json({ error: LOOKUP_FAILED }, { status: 424 });
  }

  // The same song split before: no download and no GPU run.
  const cachedId = await findCachedTask(env, linkCacheKey(link.provider, link.cacheId));
  if (cachedId) return Response.json({ taskId: cachedId, cached: true });

  const taskId = crypto.randomUUID();
  await putJob(taskId, {
    status: "uploaded",
    link: { provider: link.provider, id: link.cacheId },
    fetch: link.fetch,
    ...(link.title && { title: link.title }),
    createdAt: Date.now(),
  });

  // A GPU takes several seconds to start: let it start while the browser
  // carries on to /api/separate.
  // Spotify and Apple Music songs are found on YouTube, so they download
  // from it too.
  warmGpu({ youtube: link.provider !== "soundcloud" });
  return Response.json({ taskId, title: link.title });
}
