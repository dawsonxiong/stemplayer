import type { Route } from "./+types/api.status.$taskId";

export async function loader({ params, context }: Route.LoaderArgs) {
  const data = await context.cloudflare.env.JOBS.get<{
    status: string;
    progress?: number;
    error?: string;
    userError?: string;
  }>(params.taskId, "json");
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // Only what polling needs. A cache hit shares another upload's task, so its
  // filename and storage keys stay on the server.
  const { status, progress, error, userError } = data;
  return Response.json({ status, progress, error, userError });
}
