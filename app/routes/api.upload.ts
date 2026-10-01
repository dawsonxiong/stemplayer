import type { Route } from "./+types/api.upload";
import { MAX_FILE_SIZE_MB, ACCEPTED_FORMATS } from "~/lib/constants";
import { SHA256, findCachedTask, stemCacheKey } from "~/lib/stem-cache";
import { generatePresignedUrl } from "~/lib/utils/presigned";

const EXTENSION = /\.(mp3|wav|flac|ogg|aac|m4a)$/i;

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { filename, contentType, fileSize, hash } = (await request.json()) as {
    filename: string;
    contentType: string;
    fileSize: number;
    hash?: string | null;
  };

  const ext = filename.match(EXTENSION)?.[0].toLowerCase();
  if (!ACCEPTED_FORMATS.includes(contentType) && !ext) {
    return Response.json({ error: "Unsupported format" }, { status: 400 });
  }

  if (!(fileSize > 0) || fileSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return Response.json({ error: `File too large (${MAX_FILE_SIZE_MB}MB max)` }, { status: 400 });
  }

  // The same song split before: hand back its stems instead of another GPU run.
  // Only the separation job writes this index, from the bytes it actually
  // processed, so a client can't claim one song's hash for another's audio.
  if (hash && SHA256.test(hash)) {
    const cachedId = await findCachedTask(env, stemCacheKey(hash));
    if (cachedId) return Response.json({ taskId: cachedId, cached: true });
  }

  const taskId = crypto.randomUUID();
  // The original name is kept in KV for the title. It never goes in the key,
  // where spaces, '#' or '?' would break the signed URL.
  const r2Key = `uploads/${taskId}/input${ext ?? ""}`;

  const uploadUrl = await generatePresignedUrl({
    env,
    key: r2Key,
    method: "PUT",
    contentType,
    expiresIn: 3600,
  });

  // Save job metadata to KV (auto-expires in 14 days)
  await env.JOBS.put(
    taskId,
    JSON.stringify({
      status: "uploaded",
      filename,
      r2Key,
      createdAt: Date.now(),
    }),
    { expirationTtl: 86400 * 14 },
  );

  return Response.json({ taskId, uploadUrl });
}
