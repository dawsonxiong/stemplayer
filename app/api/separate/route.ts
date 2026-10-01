import type { Route } from "./+types/api.separate";
import { SEPARATIONS_PER_HOUR } from "~/lib/constants";

const TTL = { expirationTtl: 86400 * 14 };

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { taskId } = (await request.json()) as { taskId: string };

  const raw = await env.JOBS.get(taskId);
  if (!raw) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // An upload has an R2 key; a YouTube link has a video ID instead.
  const jobData = JSON.parse(raw) as {
    status: string;
    r2Key?: string;
    youtubeId?: string;
    createdAt: number;
  };

  // Each upload gets one GPU run. Retries of this request are no-ops.
  if (jobData.status !== "uploaded") {
    return Response.json({ status: jobData.status });
  }

  // Approximate per-IP limit. KV is eventually consistent, so a burst can
  // slip a request or two past it; that is fine for abuse protection.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const rateKey = `rl:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const used = Number((await env.JOBS.get(rateKey)) ?? 0);
  if (used >= SEPARATIONS_PER_HOUR) {
    return Response.json(
      {
        error: `Limit of ${SEPARATIONS_PER_HOUR} tracks an hour reached. Try again later.`,
      },
      { status: 429 },
    );
  }
  await env.JOBS.put(rateKey, String(used + 1), { expirationTtl: 3600 });

  await env.JOBS.put(
    taskId,
    JSON.stringify({ ...jobData, status: "processing", progress: 0 }),
    TTL,
  );

  // Only task metadata goes to Modal. R2 creds and the webhook secret live in
  // Modal secrets; the bearer token proves the call came from this Worker.
  // In dev, Modal can't reach localhost, so scripts/dev.mjs supplies a tunnel.
  const origin = import.meta.env.VITE_WEBHOOK_ORIGIN || new URL(request.url).origin;

  const modalResponse = await fetch(env.MODAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WEBHOOK_SECRET}`,
    },
    body: JSON.stringify({
      task_id: taskId,
      ...(jobData.youtubeId ? { youtube_id: jobData.youtubeId } : { input_r2_key: jobData.r2Key }),
      webhook_url: `${origin}/api/webhook`,
    }),
  });

  if (!modalResponse.ok) {
    await env.JOBS.put(
      taskId,
      JSON.stringify({
        ...jobData,
        status: "error",
        error: "Failed to start separation",
      }),
      TTL,
    );
    return Response.json({ error: "Separation failed to start" }, { status: 502 });
  }

  return Response.json({ status: "processing" });
}
