/** Whether to play a song while it's still being separated (live playback),
 *  rather than once its stems are done.
 *
 *  On unless turned off: `?live=0` (or `?live=1`), or
 *  `localStorage["stemplayer:live"] = "0"`, over the build's default,
 *  which VITE_LIVE_PLAYBACK=off turns off. The server has its own switch,
 *  LIVE_PLAYBACK, and without it a request for live playback falls back to
 *  waiting. */

const STORAGE_KEY = "stemplayer:live";

function requested(): boolean {
  const param = new URLSearchParams(window.location.search).get("live");
  if (param === "1" || param === "0") return param === "1";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "1" || stored === "0") return stored === "1";
  } catch {
    // Storage blocked: the default stands.
  }
  return import.meta.env.VITE_LIVE_PLAYBACK !== "off";
}

/** Everything the live player needs: an AudioWorklet, WebAssembly for the
 *  decoder, a module Worker to run it in, and a fetch body read as it
 *  arrives. */
function supported(): boolean {
  if (typeof AudioWorkletNode !== "function" || typeof WebAssembly !== "object") return false;
  if (typeof ReadableStream !== "function" || !("body" in Response.prototype)) return false;
  if (!("audioWorklet" in AudioContext.prototype)) return false;
  // A module Worker reads `type` from its options; one that doesn't support
  // them never asks.
  let modules = false;
  const url = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
  try {
    new Worker(url, {
      get type() {
        modules = true;
        return "module" as const;
      },
    }).terminate();
  } catch {
    modules = false;
  } finally {
    URL.revokeObjectURL(url);
  }
  return modules;
}

let cached: boolean | null = null;

export function liveEnabled(): boolean {
  if (typeof window === "undefined") return false;
  cached ??= requested() && supported();
  return cached;
}
