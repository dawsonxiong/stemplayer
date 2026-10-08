import { getJob } from "~/lib/jobs.server";

export async function GET(_request: Request, ctx: RouteContext<"/api/status/[taskId]">) {
  const { taskId } = await ctx.params;
  const data = await getJob<{
    status: string;
    progress?: number;
    error?: string;
    userError?: string;
    retryable?: boolean;
  }>(taskId);
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // Only what polling needs. A cache hit shares another upload's task, so its
  // filename and storage keys stay on the server.
  const { status, progress, error, userError, retryable } = data;
  return Response.json({ status, progress, error, userError, retryable });
}
