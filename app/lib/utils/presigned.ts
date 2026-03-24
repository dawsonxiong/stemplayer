import { AwsClient } from "aws4fetch";

interface PresignedUrlOptions {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  key: string;
  method?: "GET" | "PUT";
  contentType?: string;
  expiresIn?: number;
}

export async function generatePresignedUrl({
  accessKeyId,
  secretAccessKey,
  endpoint,
  bucket,
  key,
  method = "GET",
  contentType,
  expiresIn = 3600,
}: PresignedUrlOptions): Promise<string> {
  const r2 = new AwsClient({ accessKeyId, secretAccessKey });

  const url = new URL(`${endpoint}/${bucket}/${key}`);

  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;

  const signed = await r2.sign(new Request(url, { method, headers }), {
    aws: { signQuery: true },
  } as any);

  return signed.url;
}
