import { warmGpu } from "~/lib/warm.server";

/** The browser calls this when a song is picked, before Split is pressed. */
export function POST() {
  warmGpu();
  return new Response(null, { status: 204 });
}
