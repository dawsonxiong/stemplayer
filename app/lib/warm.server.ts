import { env } from "cloudflare:workers";
import { after } from "next/server";

/** Asks Modal to start a GPU container now, so it's up by the time the song
 *  it's for has uploaded or been looked up, rather than starting only then.
 *  After the response, so the person never waits on it; Modal sends at most
 *  one container a minute however often this is called. */
export function warmGpu(): void {
  after(
    fetch(new URL("warm", `${env.MODAL_ENDPOINT}/`), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WEBHOOK_SECRET}` },
    }).catch(() => {}),
  );
}

/** Wakes the Modal API, a small CPU container that every song goes through
 *  first and that takes 3–6 s to start cold. Called when the page loads, so
 *  it's up by the time someone picks a song. */
export function wakeModalApi(): void {
  after(fetch(new URL("health", `${env.MODAL_ENDPOINT}/`)).catch(() => {}));
}
