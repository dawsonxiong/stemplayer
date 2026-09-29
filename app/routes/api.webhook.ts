import type { Route } from "./+types/api.webhook";
import { secretMatches } from "~/lib/utils/secret";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;

  if (!secretMatches(request.headers.get("x-webhook-secret"), env.WEBHOOK_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { task_id, status, progress, stems, error } = (await request.json()) as {
    task_id: string;
    status: string;
    progress?: number;
    stems?: Record<string, string>;
    error?: string;
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

  return Response.json({ ok: true });
}
