/** Turning a parsed link into a job: checking the song exists, getting its
 *  title, and saying what the separation job should fetch. */
import { MAX_DURATION_MINUTES } from "./constants";
import {
  parseLink,
  COLLECTION_LINK,
  UNSUPPORTED_LINK,
  type ParsedLink,
  type Provider,
} from "./links";

/** What the separation job fetches. Only IDs and search terms go to Modal,
 *  never a URL, so it can't be pointed at an arbitrary page. */
export type FetchSpec =
  | { youtube_id: string }
  | { soundcloud_id: string }
  | { match: { artist: string; title: string; duration_ms: number } };

export interface ResolvedLink {
  provider: Provider;
  /** Stable per song, for recognising it when it's pasted again. */
  cacheId: string;
  title: string | null;
  fetch: FetchSpec;
}

/** A link we can't use, with a message written for the person. */
export class LinkError extends Error {}

const NOT_FOUND = "That song doesn’t exist or was taken down. Check the link.";
const TOO_LONG = `That song is over ${MAX_DURATION_MINUTES} minutes. Try a shorter one.`;

export async function resolveLink(parsed: ParsedLink): Promise<ResolvedLink> {
  if (parsed.kind === "short") parsed = await followShortLink(parsed.url);
  if (parsed.kind === "collection") throw new LinkError(COLLECTION_LINK);
  if (parsed.kind === "short") throw new LinkError(UNSUPPORTED_LINK);

  switch (parsed.provider) {
    case "youtube":
      return resolveYouTube(parsed.id);
    case "soundcloud":
      return resolveSoundCloud(parsed.id);
    case "apple":
      return resolveApple(parsed.id, parsed.storefront ?? "us");
    case "spotify":
      return resolveSpotify(parsed.id);
  }
}

/** on.soundcloud.com and spotify.link codes, from the apps' share sheets. */
async function followShortLink(url: string): Promise<ParsedLink> {
  const res = await fetch(url, { redirect: "follow" }).catch(() => null);
  if (!res?.ok) throw new LinkError(NOT_FOUND);
  const landed = parseLink(res.url);
  if (landed && landed.kind !== "short") return landed;
  // spotify.link answers with a page that sends you on in script, not a redirect.
  const body = await res.text();
  const target = body.match(
    /https:\/\/open\.spotify\.com\/(?:track|album|playlist)\/[A-Za-z0-9]{22}/,
  );
  const parsed = target ? parseLink(target[0]) : null;
  if (!parsed || parsed.kind === "short") throw new LinkError(UNSUPPORTED_LINK);
  return parsed;
}

async function resolveYouTube(id: string): Promise<ResolvedLink> {
  // oEmbed gives the title up front and catches a mistyped ID before it costs
  // a GPU start. A private or unembeddable video answers 401 or 403; the
  // job's download decides those.
  const res = await oembed(`https://www.youtube.com/oembed?format=json&url=${watchUrl(id)}`);
  if (res?.status === 400 || res?.status === 404) throw new LinkError(NOT_FOUND);
  const data = res?.ok ? await json<{ title?: unknown }>(res) : {};
  return { provider: "youtube", cacheId: id, title: text(data.title), fetch: { youtube_id: id } };
}

async function resolveSoundCloud(path: string): Promise<ResolvedLink> {
  const page = encodeURIComponent(`https://soundcloud.com/${path}`);
  const res = await oembed(`https://soundcloud.com/oembed?format=json&url=${page}`);
  if (res?.status === 404) throw new LinkError(NOT_FOUND);
  if (!res?.ok) throw new Error(`SoundCloud oEmbed failed (${res?.status ?? "network"})`);
  const data = await json<{ title?: unknown; html?: unknown }>(res);
  const html = typeof data.html === "string" ? data.html : "";
  // The player embed names the numeric ID, which survives renames.
  if (/playlists(?:%2F|\/)\d+/.test(html)) throw new LinkError(COLLECTION_LINK);
  const id = html.match(/tracks(?:%2F|\/)(\d+)/)?.[1];
  if (!id) throw new Error("SoundCloud oEmbed had no track ID");
  return {
    provider: "soundcloud",
    cacheId: id,
    title: text(data.title),
    fetch: { soundcloud_id: id },
  };
}

async function resolveApple(id: string, storefront: string): Promise<ResolvedLink> {
  // The iTunes lookup API answers 403 to Cloudflare's addresses, so this reads
  // the song's own page, which carries schema.org data for search engines: a
  // MusicComposition whose `audio` is the recording, with its artist and
  // length. An unknown ID, or one for an album, is a 404.
  const res = await fetch(`https://music.apple.com/${storefront}/song/${id}`).catch(() => null);
  if (res?.status === 404) throw new LinkError(NOT_FOUND);
  if (!res?.ok) throw new Error(`Apple Music page failed (${res?.status ?? "network"})`);
  const html = await res.text();
  const raw = html.match(/<script[^>]*application\/ld\+json[^>]*>(.*?)<\/script>/s)?.[1];
  type Recording = { name?: string; duration?: string; byArtist?: { name?: string }[] };
  const recording = raw ? (JSON.parse(raw) as { audio?: Recording }).audio : undefined;
  const artist = recording?.byArtist?.[0]?.name;
  const durationMs = isoDurationMs(recording?.duration);
  if (!recording?.name || !artist || !durationMs) {
    throw new Error("Apple Music page changed: no song name, artist or duration");
  }
  return matched("apple", id, artist, recording.name, durationMs);
}

/** "PT4M11S" in milliseconds, or null if it isn't a duration like that. */
function isoDurationMs(value: string | undefined): number | null {
  const parts = value?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!parts) return null;
  const [, hours = "0", minutes = "0", seconds = "0"] = parts;
  const ms = ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
  return ms > 0 ? ms : null;
}

async function resolveSpotify(id: string): Promise<ResolvedLink> {
  // Spotify's public oEmbed has the title but not the artist or length, and
  // its Web API needs registered app keys. The embed player's page carries all
  // three in its Next.js data. It isn't a published API, so if Spotify
  // changes that page this is what breaks; the error below says so in the logs.
  const res = await fetch(`https://open.spotify.com/embed/track/${id}`).catch(() => null);
  if (!res?.ok) throw new Error(`Spotify embed failed (${res?.status ?? "network"})`);
  const html = await res.text();
  const raw = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s,
  )?.[1];
  type Entity = { type?: string; name?: string; duration?: number; artists?: { name?: string }[] };
  const props = raw
    ? (
        JSON.parse(raw) as {
          props?: { pageProps?: { status?: number; state?: { data?: { entity?: Entity } } } };
        }
      ).props?.pageProps
    : undefined;
  if (props?.status === 404) throw new LinkError(NOT_FOUND);

  const entity = props?.state?.data?.entity;
  const artist = entity?.artists?.[0]?.name;
  if (entity?.type !== "track" || !entity.name || !artist || !entity.duration) {
    throw new Error("Spotify embed page changed: no track name, artist or duration");
  }
  return matched("spotify", id, artist, entity.name, entity.duration);
}

/** A song found on YouTube by the job. Its length is known now, so a long one
 *  is turned away before it costs a GPU start. */
function matched(
  provider: Provider,
  id: string,
  artist: string,
  title: string,
  durationMs: number,
): ResolvedLink {
  if (durationMs > MAX_DURATION_MINUTES * 60_000) throw new LinkError(TOO_LONG);
  return {
    provider,
    cacheId: id,
    title: `${artist} – ${title}`,
    fetch: { match: { artist, title, duration_ms: Math.round(durationMs) } },
  };
}

const watchUrl = (id: string) => encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
const oembed = (url: string) => fetch(url).catch(() => null);
const json = <T>(res: Response) => res.json().catch(() => ({})) as Promise<T>;
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
