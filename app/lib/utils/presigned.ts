import { AwsClient } from "aws4fetch";

export const BUCKET = "stem-player-audio";

interface PresignedUrlOptions {
  env: Env;
  key: string;
  method?: "GET" | "PUT";
  contentType?: string;
  expiresIn?: number;
}

export async function generatePresignedUrl({
  env,
  key,
  method = "GET",
  contentType,
  expiresIn = 3600,
}: PresignedUrlOptions): Promise<string> {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is not set. In dev, run `pnpm dev` " +
        "(loads them from 1Password); in production, set them with `wrangler secret put`.",
    );
  }

  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(`${env.R2_PUBLIC_ENDPOINT}/${BUCKET}/${key}`);
  // aws4fetch defaults presigned URLs to 24h unless this is set first.
  url.searchParams.set("X-Amz-Expires", String(expiresIn));

  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;

  const signed = await r2.sign(new Request(url, { method, headers }), {
    aws: { signQuery: true },
  });

  return signed.url;
}
