// Augment the Cloudflare Env interface with secrets
// These are set via `npx wrangler secret put <NAME>` and not in wrangler.jsonc
declare namespace Cloudflare {
  interface Env {
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    WEBHOOK_SECRET: string;
  }
}
