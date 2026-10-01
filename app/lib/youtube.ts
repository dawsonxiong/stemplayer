/** Reading a YouTube video out of whatever link someone pastes. */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = /^(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com$/;

/** The 11-character video ID from a watch, share, Shorts, embed or live link,
 *  or null if the text isn't a link to one YouTube video. */
export function parseYouTubeId(text: string): string | null {
  let url: URL;
  try {
    // People paste "youtu.be/…" or "www.youtube.com/…" without the scheme.
    url = new URL(/^https?:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (HOSTS.test(host)) {
    const [, first, second] = url.pathname.split("/");
    id =
      first === "watch"
        ? url.searchParams.get("v")
        : ["shorts", "embed", "live", "v"].includes(first ?? "")
          ? (second ?? null)
          : null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export const youTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
