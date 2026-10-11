interface ImportMetaEnv {
  /** Public URL Modal calls back to in dev; set by scripts/dev.mjs. */
  readonly VITE_WEBHOOK_ORIGIN?: string;
  /** "off" makes playing while separating opt-in in this build (app/lib/audio/live-support.ts). */
  readonly VITE_LIVE_PLAYBACK?: string;
}
