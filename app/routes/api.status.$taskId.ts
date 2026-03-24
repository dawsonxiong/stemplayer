import type { Route } from "./+types/api.status.$taskId";

export async function loader({ params, context }: Route.LoaderArgs) {
  const data = await context.cloudflare.env.JOBS.get(params.taskId, "json");
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(data);
}
