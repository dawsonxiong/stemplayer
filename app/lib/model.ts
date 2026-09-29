// Imported through Vite so the build gives it a content-hashed name under
// /assets/, which public/_headers caches for a year. A new model is a new URL.
import modelUrl from "~/assets/stemplayer.glb?url";

export const MODEL_URL = modelUrl;
