import { wakeModalApi } from "~/lib/warm.server";

export function POST() {
  wakeModalApi();
  return new Response(null, { status: 204 });
}
