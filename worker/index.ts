/** The Worker's entry: the live relay's two routes, then everything else to
 *  vinext's App Router. Durable Objects have to be exported from here.
 *
 *  - GET /api/live/<taskId>: the browser's stream of a job's stems.
 *  - /api/live/<taskId>/ingest: the Modal job's WebSocket that feeds it,
 *    authed with the webhook secret.
 *
 *  Both 404 unless LIVE_PLAYBACK is "on". */
import handler from "vinext/server/fetch-handler";
import { TASK_ID, getJob, liveEnabled } from "../app/lib/jobs.server";
import { secretMatches } from "../app/lib/utils/secret";

export { LiveRelay } from "./live-relay";

const LIVE_ROUTE = /^\/api\/live\/([^/]+)(\/ingest)?$/;

async function live(request: Request, env: Env, taskId: string, ingest: boolean) {
  if (!liveEnabled(env) || !TASK_ID.test(taskId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (ingest) {
    if (!secretMatches(request.headers.get("x-webhook-secret"), env.WEBHOOK_SECRET)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    // Only tasks that exist get a relay.
    if (!(await getJob(taskId))) return Response.json({ error: "Not found" }, { status: 404 });
  }
  // One object per task, created wherever it's first asked for: the browser
  // opens its stream as it starts the job, so that's near the person.
  return env.LIVE.get(env.LIVE.idFromName(taskId)).fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    const route = LIVE_ROUTE.exec(new URL(request.url).pathname);
    if (route) return live(request, env, route[1], Boolean(route[2]));
    return handler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
