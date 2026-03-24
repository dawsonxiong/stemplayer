import type { Route } from "./+types/api.upload";
import { AwsClient } from "aws4fetch";
import { MAX_FILE_SIZE_MB, ACCEPTED_FORMATS } from "~/lib/constants";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { filename, contentType, fileSize } = (await request.json()) as {
    filename: string;
    contentType: string;
    fileSize: number;
  };

  if (
    !ACCEPTED_FORMATS.includes(contentType) &&
    !filename.match(/\.(mp3|wav|flac|ogg|aac|m4a)$/i)
  ) {
    return Response.json({ error: "Unsupported format" }, { status: 400 });
  }

  if (fileSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return Response.json(
      { error: `File too large (${MAX_FILE_SIZE_MB}MB max)` },
      { status: 400 }
    );
  }

  const taskId = crypto.randomUUID();
  const r2Key = `uploads/${taskId}/${filename}`;

  // Generate presigned PUT URL for direct browser → R2 upload
  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(
    `${env.R2_PUBLIC_ENDPOINT}/stem-player-audio/${r2Key}`
  );

  const signed = await r2.sign(
    new Request(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    { aws: { signQuery: true } } as any
  );

  // Save job metadata to KV (auto-expires in 14 days)
  await env.JOBS.put(
    taskId,
    JSON.stringify({
      status: "uploaded",
      filename,
      r2Key,
      createdAt: Date.now(),
    }),
    { expirationTtl: 86400 * 14 }
  );

  return Response.json({ taskId, uploadUrl: signed.url });
}
