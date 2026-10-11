import { env } from "cloudflare:workers";
import { after } from "next/server";

/** Asks Modal to start a GPU container now, so it's up by the time the song
 *  it's for has uploaded or been looked up, rather than starting only then.
 *  With `youtube`, also the downloaders in other regions that stand in when
 *  YouTube refuses the first, so a refused song doesn't wait for them to
 *  start cold. After the response, so the person never waits on it; Modal
 *  starts each at most once a minute however often this is called. */
export function warmGpu({ youtube = false } = {}): void {
  after(
    fetch(new URL(youtube ? "warm?youtube=1" : "warm", `${env.MODAL_ENDPOINT}/`), {
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
