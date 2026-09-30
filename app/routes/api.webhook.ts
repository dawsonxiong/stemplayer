import type { Route } from "./+types/api.webhook";
import { secretMatches } from "~/lib/utils/secret";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;

  if (!secretMatches(request.headers.get("x-webhook-secret"), env.WEBHOOK_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { task_id, status, progress, stems, error, input_sha256 } = (await request.json()) as {
    task_id: string;
    status: string;
    progress?: number;
    stems?: Record<string, string>;
    error?: string;
    /** Hash of the audio the job downloaded, for recognising re-uploads. */
    input_sha256?: string;
  };

  const raw = await env.JOBS.get(task_id);
  if (!raw) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const existing = JSON.parse(raw) as { status: string };
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
      ...(done && { completedAt: Date.now() }),
    }),
    { expirationTtl: 86400 * 14 },
  );

  // Expires with the job, since the stems it points at go at the same time.
  if (status === "ready" && input_sha256 && /^[0-9a-f]{64}$/.test(input_sha256)) {
    await env.JOBS.put(`hash:${input_sha256}`, task_id, { expirationTtl: 86400 * 14 });
  }

  return Response.json({ ok: true });
}
