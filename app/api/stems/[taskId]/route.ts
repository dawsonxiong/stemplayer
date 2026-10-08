import { env } from "cloudflare:workers";
import { getJob } from "~/lib/jobs.server";
import { generatePresignedUrl } from "~/lib/utils/presigned";
import { titleFromFilename } from "~/lib/utils/title";

export async function GET(_request: Request, ctx: RouteContext<"/api/stems/[taskId]">) {
  const { taskId } = await ctx.params;
  const data = await getJob<{
    status: string;
    /** A link's song title. Uploads only have their filename. */
    title?: string;
    /** For a Spotify or Apple Music song, the YouTube video it was found as. */
    matchedVideo?: { id: string; title: string };
    filename?: string;
    createdAt?: number;
    stems?: Record<string, string>;
    /** What each stem was stored at. Older jobs stored them as they were. */
    stemGains?: Record<string, number>;
  }>(taskId);
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Only while a job from before records moved to R2 is still in KV, whose
  // reads can lag the status poll that just saw "ready". 409 tells the client
  // to ask again, not to give up.
  if (data.status === "uploaded" || data.status === "processing") {
    return Response.json({ error: "Stems not ready" }, { status: 409 });
  }
  if (data.status !== "ready" || !data.stems) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const entries = await Promise.all(
    Object.entries(data.stems).map(
      async ([stem, key]) =>
        [stem, await generatePresignedUrl({ env, key, expiresIn: 7200 })] as const,
    ),
  );

  return Response.json({
    stems: Object.fromEntries(entries),
    title: data.title ?? (data.filename ? titleFromFilename(data.filename) : "Untitled"),
    createdAt: data.createdAt ?? null,
    matchedVideo: data.matchedVideo ?? null,
    gains: data.stemGains ?? {},
  });
}
