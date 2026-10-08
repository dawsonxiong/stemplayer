/** What the browser needs to load a finished job's stems: shared by
 *  /api/stems and the status poll that sees "ready", so a fresh split
 *  doesn't wait on a second request before loading. */
import { env } from "cloudflare:workers";
import { generatePresignedUrl } from "./utils/presigned";
import { titleFromFilename } from "./utils/title";

export type FinishedJob = {
  status: string;
  /** A link's song title. Uploads only have their filename. */
  title?: string;
  /** For a Spotify or Apple Music song, the YouTube video it was found as. */
  matchedVideo?: { id: string; title: string };
  filename?: string;
  createdAt?: number;
  stems?: Record<string, string>;
  /** What each stem was stored at. Older jobs stored them as they were. */
  stemGains?: Record<string, number>;
};

export async function stemsToLoad(job: FinishedJob & { stems: Record<string, string> }) {
  const entries = await Promise.all(
    Object.entries(job.stems).map(
      async ([stem, key]) =>
        [stem, await generatePresignedUrl({ env, key, expiresIn: 7200 })] as const,
    ),
  );
  return {
    stems: Object.fromEntries(entries),
    title: job.title ?? (job.filename ? titleFromFilename(job.filename) : "Untitled"),
    createdAt: job.createdAt ?? null,
    matchedVideo: job.matchedVideo ?? null,
    gains: job.stemGains ?? {},
  };
}
