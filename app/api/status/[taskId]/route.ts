import { getJob } from "~/lib/jobs.server";
import { type FinishedJob, stemsToLoad } from "~/lib/stems.server";

type Job = FinishedJob & {
  status: string;
  progress?: number;
  error?: string;
  userError?: string;
  retryable?: boolean;
};

/** What a poller has seen, to wait for something else. */
const stateOf = (job: Job) => `${job.status}:${job.progress ?? ""}`;

// How long a request waits for a change, and how often it looks meanwhile.
// Job records are in R2, which is consistent everywhere, so looking from the
// Worker is cheap and as fresh as it gets.
const WAIT_MS = 20_000;
const LOOK_EVERY_MS = 250;

export async function GET(request: Request, ctx: RouteContext<"/api/status/[taskId]">) {
  const { taskId } = await ctx.params;
  // With ?since=<state>, answer once the job has moved on from it (or after
  // WAIT_MS), so the browser hears about "ready" within a quarter second
  // rather than at its next poll.
  const since = new URL(request.url).searchParams.get("since");
  const until = Date.now() + WAIT_MS;

  let data = await getJob<Job>(taskId);
  while (data && since !== null && stateOf(data) === since && Date.now() < until) {
    await new Promise((r) => setTimeout(r, LOOK_EVERY_MS));
    data = await getJob<Job>(taskId);
  }
  if (!data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // Only what polling needs. A cache hit shares another upload's task, so its
  // filename and storage keys stay on the server.
  const { status, progress, error, userError, retryable } = data;
  // Ready: what /api/stems would say too, so loading can start at once.
  const load =
    status === "ready" && data.stems
      ? await stemsToLoad({ ...data, stems: data.stems })
      : undefined;
  return Response.json({ status, progress, error, userError, retryable, load });
}
