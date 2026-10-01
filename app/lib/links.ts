/** Reading a song out of whatever link someone pastes. Shared by the page,
 *  which checks a link before sending it, and the Worker, which resolves it. */

export type Provider = "youtube" | "soundcloud" | "apple" | "spotify";

/** Spotify and Apple Music audio is DRM-protected, so their songs are found
 *  on YouTube by artist, title and length, and that video is split instead. */
export const MATCHED_PROVIDERS: readonly Provider[] = ["apple", "spotify"];

export const PROVIDER_NAMES: Record<Provider, string> = {
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  apple: "Apple Music",
  spotify: "Spotify",
};

export type ParsedLink =
  /** One song. `id` is the YouTube video ID, the SoundCloud "artist/track"
   *  path, the Apple Music track ID or the Spotify track ID. */
  | { kind: "track"; provider: Provider; id: string; storefront?: string }
  /** An album, playlist or set: more than one song, so not splittable. */
  | { kind: "collection"; provider: Provider }
  /** A share link that only says where it goes once followed. */
  | { kind: "short"; provider: "soundcloud" | "spotify"; url: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const DIGITS = /^\d+$/;
const SLUG = /^[\w-]+$/;

const YOUTUBE_HOSTS = /^(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com$/;
const SOUNDCLOUD_HOSTS = /^(?:www\.|m\.)?soundcloud\.com$/;
const APPLE_HOSTS = /^(?:(?:geo\.)?music|itunes)\.apple\.com$/;

// soundcloud.com/<first> pages that are the site's own, not an artist's.
const SOUNDCLOUD_PAGES = new Set([
  "discover",
  "stream",
  "you",
  "search",
  "upload",
  "charts",
  "stations",
  "pages",
  "settings",
  "messages",
  "notifications",
  "people",
  "tags",
  "popular",
  "mobile",
  "jobs",
  "imprint",
  "terms-of-use",
]);
// soundcloud.com/<artist>/<second> tabs that list many tracks.
const SOUNDCLOUD_LISTS = new Set([
  "sets",
  "likes",
  "tracks",
  "albums",
  "reposts",
  "popular-tracks",
  "followers",
  "following",
  "comments",
]);

/** What a pasted link points at, or null if it isn't one we can split. */
export function parseLink(text: string): ParsedLink | null {
  const trimmed = text.trim();

  const uri = trimmed.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/);
  if (uri) {
    return uri[1] === "track"
      ? { kind: "track", provider: "spotify", id: uri[2]! }
      : { kind: "collection", provider: "spotify" };
  }

  let url: URL;
  try {
    // People paste "youtu.be/…" or "open.spotify.com/…" without the scheme.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" || YOUTUBE_HOSTS.test(host)) return parseYouTube(host, path, url);
  if (SOUNDCLOUD_HOSTS.test(host)) return parseSoundCloud(path);
  if (host === "on.soundcloud.com" && path.length === 1) {
    return { kind: "short", provider: "soundcloud", url: url.href };
  }
  if (APPLE_HOSTS.test(host)) return parseApple(path, url);
  if (host === "open.spotify.com") return parseSpotify(path);
  if (host === "spotify.link" && path.length === 1) {
    return { kind: "short", provider: "spotify", url: url.href };
  }
  return null;
}

function parseYouTube(host: string, path: string[], url: URL): ParsedLink | null {
  const [first, second] = path;
  const id =
    host === "youtu.be"
      ? first
      : first === "watch"
        ? url.searchParams.get("v")
        : ["shorts", "embed", "live", "v"].includes(first ?? "")
          ? second
          : null;
  if (id && YOUTUBE_ID.test(id)) return { kind: "track", provider: "youtube", id };
  if (first === "playlist") return { kind: "collection", provider: "youtube" };
  return null;
}

function parseSoundCloud(path: string[]): ParsedLink | null {
  const [artist, second] = path;
  if (!artist || SOUNDCLOUD_PAGES.has(artist) || !SLUG.test(artist)) return null;
  if (second && SOUNDCLOUD_LISTS.has(second)) return { kind: "collection", provider: "soundcloud" };
  // A third part is a private track's secret token, which oEmbed can't read.
  if (path.length !== 2 || !SLUG.test(second!)) return null;
  return { kind: "track", provider: "soundcloud", id: `${artist}/${second}` };
}

function parseApple(path: string[], url: URL): ParsedLink | null {
  // /us/song/never-gonna-give-you-up/1773293184, or an album with ?i=<track>.
  const storefront = /^[a-z]{2}$/i.test(path[0] ?? "") ? path.shift()!.toLowerCase() : "us";
  const [type] = path;
  const last = path.at(-1) ?? "";
  if (type === "song" && DIGITS.test(last)) {
    return { kind: "track", provider: "apple", id: last, storefront };
  }
  if (type === "album") {
    const track = url.searchParams.get("i");
    return track && DIGITS.test(track)
      ? { kind: "track", provider: "apple", id: track, storefront }
      : { kind: "collection", provider: "apple" };
  }
  if (type === "playlist" || type === "artist") return { kind: "collection", provider: "apple" };
  return null;
}

function parseSpotify(path: string[]): ParsedLink | null {
  // Localised links put "intl-de" or similar first.
  if (/^intl-/.test(path[0] ?? "")) path = path.slice(1);
  const [type, id] = path;
  if (!id || !SPOTIFY_ID.test(id)) return null;
  if (type === "track") return { kind: "track", provider: "spotify", id };
  if (type === "album" || type === "playlist" || type === "artist") {
    return { kind: "collection", provider: "spotify" };
  }
  return null;
}

export const UNSUPPORTED_LINK =
  "That link isn’t a song on YouTube, SoundCloud, Spotify or Apple Music.";
export const COLLECTION_LINK =
  "That’s a link to an album or playlist. Open one song and copy its link.";
