import type { Route } from "./+types/api.separate";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { taskId } = (await request.json()) as { taskId: string };

  const raw = await env.JOBS.get(taskId);
  if (!raw) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const jobData = JSON.parse(raw) as {
    status: string;
    filename: string;
    r2Key: string;
    createdAt: number;
  };

  // Update status
  await env.JOBS.put(
    taskId,
    JSON.stringify({ ...jobData, status: "processing", progress: 0 }),
    { expirationTtl: 86400 * 14 }
  );

  // Trigger Modal — only send task metadata, R2 creds are Modal secrets
  const origin = new URL(request.url).origin;

  const modalResponse = await fetch(env.MODAL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      input_r2_key: jobData.r2Key,
      webhook_url: `${origin}/api/webhook`,
      webhook_secret: env.WEBHOOK_SECRET,
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
      { expirationTtl: 86400 * 14 }
    );
    return Response.json(
      { error: "Separation failed to start" },
      { status: 500 }
    );
  }

  return Response.json({ status: "processing" });
}
