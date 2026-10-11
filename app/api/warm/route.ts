import { warmGpu } from "~/lib/warm.server";

/** The browser calls this when a song is picked, before Split is pressed;
 *  `?youtube=1` for a song that will download from YouTube. */
export function POST(request: Request) {
  warmGpu({ youtube: new URL(request.url).searchParams.get("youtube") === "1" });
  return new Response(null, { status: 204 });
}
