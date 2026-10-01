import { env } from "cloudflare:workers";
import { generatePresignedUrl } from "~/lib/utils/presigned";
import { titleFromFilename } from "~/lib/utils/title";

export async function GET(_request: Request, ctx: RouteContext<"/api/stems/[taskId]">) {
  const { taskId } = await ctx.params;
  const raw = await env.JOBS.get(taskId);

  if (!raw) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const data = JSON.parse(raw) as {
    status: string;
    /** A YouTube video's title. Uploads only have their filename. */
    title?: string;
    filename?: string;
    createdAt?: number;
    stems?: Record<string, string>;
  };

  if (data.status !== "ready" || !data.stems) {
    return Response.json({ error: "Stems not ready" }, { status: 404 });
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
  });
}
