/** Recognising a song that was split before, by the SHA-256 of its bytes. */

export const SHA256 = /^[0-9a-f]{64}$/;

// Names what produced the stems. Bump it whenever modal/app.py changes the
// model or output format, so old results stop being served for new uploads.
const OUTPUT_VERSION = "htdemucs-mp3-192";

export const stemCacheKey = (hash: string) => `hash:${OUTPUT_VERSION}:${hash}`;
