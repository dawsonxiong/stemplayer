import { env } from "cloudflare:workers";
import { getJob, putJob } from "~/lib/jobs.server";
import { SEPARATIONS_PER_HOUR } from "~/lib/constants";
import type { FetchSpec } from "~/lib/links.server";

export async function POST(request: Request) {
  const { taskId } = (await request.json()) as { taskId: string };

  // An upload has an R2 key; a link says what the job should fetch instead.
  const jobData = await getJob<{
    status: string;
    r2Key?: string;
    fetch?: FetchSpec;
    createdAt: number;
  }>(taskId);
  if (!jobData) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

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

  await putJob(taskId, { ...jobData, status: "processing", progress: 0 });

  // Only task metadata goes to Modal. R2 creds and the webhook secret live in
  // Modal secrets; the bearer token proves the call came from this Worker.
  // In dev, Modal can't reach localhost, so scripts/dev.mjs supplies a tunnel.
  const origin = import.meta.env.VITE_WEBHOOK_ORIGIN || new URL(request.url).origin;

  // A Modal that can't be reached at all throws rather than answering, and
  // would otherwise leave the job "processing" for good.
  const modalResponse = await fetch(env.MODAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WEBHOOK_SECRET}`,
    },
    body: JSON.stringify({
      task_id: taskId,
      ...(jobData.fetch ?? { input_r2_key: jobData.r2Key }),
      webhook_url: `${origin}/api/webhook`,
    }),
  }).catch((err: unknown) => err as Error);

  if (modalResponse instanceof Error || !modalResponse.ok) {
    // Modal's reason, for the logs: a bad secret (401), a refused input (400)
    // and Modal itself timing out (408) all look the same to the person.
    const reason =
      modalResponse instanceof Error
        ? modalResponse.message
        : `${modalResponse.status} ${(await modalResponse.text().catch(() => "")).slice(0, 300)}`;
    console.error(`Modal refused ${taskId}: ${reason}`);
    await putJob(taskId, { ...jobData, status: "error", error: "Failed to start separation" });
    return Response.json({ error: "Separation failed to start" }, { status: 502 });
  }

  return Response.json({ status: "processing" });
}
