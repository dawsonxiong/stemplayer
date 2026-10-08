import { getJob } from "~/lib/jobs.server";
import { type FinishedJob, stemsToLoad } from "~/lib/stems.server";

export async function GET(_request: Request, ctx: RouteContext<"/api/stems/[taskId]">) {
  const { taskId } = await ctx.params;
  const data = await getJob<FinishedJob>(taskId);
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Only while a job from before records moved to R2 is still in KV, whose
  // reads can lag the status poll that just saw "ready". 409 tells the client
  // to ask again, not to give up.
  if (data.status === "uploaded" || data.status === "processing") {
    return Response.json({ error: "Stems not ready" }, { status: 409 });
  }
  if (data.status !== "ready" || !data.stems) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(await stemsToLoad({ ...data, stems: data.stems }));
}
