interface ImportMetaEnv {
  /** Public URL Modal calls back to in dev; set by scripts/dev.mjs. */
  readonly VITE_WEBHOOK_ORIGIN?: string;
  /** "on" makes live playback the default in this build (app/lib/audio/live-support.ts). */
  readonly VITE_LIVE_PLAYBACK?: string;
}
