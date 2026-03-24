import type { Route } from "./+types/api.stems.$taskId";
import { AwsClient } from "aws4fetch";

export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const raw = await env.JOBS.get(params.taskId);

  if (!raw) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const data = JSON.parse(raw) as {
    status: string;
    filename: string;
    stems?: Record<string, string>;
  };

  if (data.status !== "ready" || !data.stems) {
    return Response.json({ error: "Stems not ready" }, { status: 404 });
  }

  // Generate presigned GET URLs for each stem
  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const urls: Record<string, string> = {};

  for (const [stem, key] of Object.entries(data.stems)) {
    const url = new URL(
      `${env.R2_PUBLIC_ENDPOINT}/stem-player-audio/${key}`
    );
    const signed = await r2.sign(new Request(url), {
      aws: { signQuery: true },
    } as any);
    urls[stem] = signed.url;
  }

  return Response.json({ stems: urls, title: data.filename });
}
