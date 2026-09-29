interface ImportMetaEnv {
  /** Public URL Modal calls back to in dev; set by scripts/dev.mjs. */
  readonly VITE_WEBHOOK_ORIGIN?: string;
}

// Augment the Cloudflare Env interface with secrets
// These are set via `pnpm wrangler secret put <NAME>` and not in wrangler.jsonc
declare namespace Cloudflare {
  interface Env {
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    WEBHOOK_SECRET: string;
  }
}
