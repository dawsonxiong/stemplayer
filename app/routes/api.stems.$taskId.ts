import type { Route } from "./+types/api.stems.$taskId";
import { generatePresignedUrl } from "~/lib/utils/presigned";

export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const raw = await env.JOBS.get(params.taskId);

  if (!raw) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const data = JSON.parse(raw) as {
    status: string;
    filename: string;
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
    title: data.filename,
    createdAt: data.createdAt ?? null,
  });
}
