# Plan: progressive playback

Status: proposed, not started. Written 2026-10-08.

## Summary

Today nothing plays until the whole job is done. For a warm 4-minute song in production:
- "ready" reaches the browser at 7.5 s after Split.
- All four stems can play at 7.7 s.

The aim is for sound to start once the first stretch of all four stems exists, then hand over seamlessly to the finished R2 files.

**Recommendation:**
- **Transport:** a Durable Object per task relays the stream (`LiveRelay`).
  - Modal pushes the existing LAME bytes into it with one chunked `POST`, fed by `StreamingMP3(on_data=…)`.
  - The browser reads a streaming `fetch` response from it.
- **Format:** raw MP3 frames, byte-identical to the R2 files.
- **Playback while streaming:** don't use MSE. Instead:
  - A Web Worker decodes the four streams with a WASM MP3 decoder.
  - One AudioWorklet node with four outputs plays them into the existing per-stem gain → analyser → bus → effects → master → limiter graph.
  - So the recorder, effects and analysers stay as they are.
- **Handover:** splice at an MP3 frame index inside the decoder.
  - For a stem that wasn't rescaled, the R2 file *is* the stream, so R2 only fills gaps and nothing switches.
- **Expected:** first sound at **≈3.4–3.8 s after Split**, against 7.7 s today. That's about 4 s saved on a warm 4-minute song.
  - That's ≈0.4–0.6 s after `separate` starts in Modal.
  - First sound no longer depends on the song's length, so longer songs save more.

**Why not MSE:** Safari's MSE plus `createMediaElementSource` path has open WebKit bugs.
- In [266922](https://bugs.webkit.org/show_bug.cgi?id=266922), a `MediaElementAudioSourceNode` gets no samples from a MediaSource-backed element.
- In [180696](https://bugs.webkit.org/show_bug.cgi?id=180696), MSE audio bypasses the graph.
- If those still hold, stem sliders, analysers and the recorder would break on Safari and iOS. Phase 0 probes it on real devices.

## 0. Facts the design relies on

- **When the first stretch arrives.** `separate_stream` (`modal/stemsep/engine.py`) first emits after a `first_batch=2` pass.
  - That first `sink` covers ≈8.2 s of audio, after ≈16 s has been decoded (~40 ms) plus one 2-chunk GPU pass (~0.1–0.15 s).
  - Later sinks come once per 8-chunk batch, ≈56 s of audio each, every ~0.5–0.8 s, at the pace LAME sets.
- **How bytes come out of the encoder.** `StreamingMP3._run` (`audio.py`) calls `on_data(name, chunk)` per stretch and per flush.
  - A stem that isn't rescaled ends with `data` equal to its streamed chunks.
  - A stem that needs rescaling stops its streamed encode where clipping was found (correct audio at gain 0.5, but incomplete). `finish` then re-encodes it whole at a lower gain. The browser sees `gains[stem] < STEM_GAIN`.
- **The `NotStreamable` fallback** in `_separate` closes the encoder, makes a new one and separates the whole song again.
  - It can be raised before any data streams (m4a or webm from links), part-way through, or after the last block. The last two need a stream **reset**.
- **Data rate.** 192 kbps CBR is 24 KB/s per stem, ≈96 KB/s for four. A 4-minute song is 23.5 MB in all; a 10-minute song is ≈58 MB.
  - Modal produces it in ~3.5 s. The browser needs only real time after the first second, as long as the relay **interleaves stems by audio time**.
- **The current player.** `AudioEngine.loadStems` plays four `HTMLAudioElement`s.
  - Restore gain is folded into `applyGain`. The loop is a 20 ms `setInterval`. `MixRecorder` taps the limiter.
  - The AudioContext is created lazily in `getContext()`.
- **The Worker entry.** `wrangler.jsonc` mains `vinext/server/fetch-handler`. A Durable Object must be exported from the main module, and vinext supports a custom `worker/index.ts` entry (`resolveWorkerEntry` in `vinext/dist/init-cloudflare.js`).

## 1. Transport

| Option | Latency from `on_data` to the browser holding the bytes | Notes |
|---|---|---|
| **A. DO relay** (chunked POST in, streaming fetch out) | **~50–150 ms** | Outlives the producer, so a slow phone drains after the job ends. Replay and resume for free. Negligible cost. Needs a custom Worker entry and a DO migration. |
| B. Segment objects in R2 + notify | ~0.5–1.0 s | A PUT, then a notify (webhook → conditional R2 job write → 250 ms long-poll), then a GET. ETag contention per stretch. Coarse: ~5 stretches a song. |
| C. Modal serves the stream through a `modal.forward` tunnel | ~100 ms + ~1 s setup | Holds the GPU until the slowest browser drains: 20 s of A10 time on a 10 Mbit/s connection. |
| D. `modal.Queue` read by the API container | ~100–300 ms | Item size limits; a CPU container sits in the data path. |

**Pick A.**

- **Modal → DO: a chunked HTTP POST** (a `requests` generator body) to `{webhook origin}/api/live/<taskId>/ingest`.
  - The URL is derived from the `webhook_url` Modal already receives, and it's authed with `x-webhook-secret`.
  - The connection opens at the top of `_separate`, so TLS is done before the first bytes.
  - If Cloudflare turns out to buffer chunked request bodies, use a WebSocket ingest instead.
- **DO → browser: a streaming `fetch`** of `GET /api/live/<taskId>?from=<per-stem byte offsets>`.
  - Headers: `application/octet-stream`, `Cache-Control: no-store, no-transform`.
  - Resuming is just a new request with offsets.
- **Placement.** The browser opens the live GET in parallel with `POST /api/separate`, so the DO is created near the person.
- **Latency per hop, warm, desktop:**
  - sender queue: <5 ms
  - Modal (us) → Cloudflare edge: ~5–10 ms
  - edge → DO: ~15–60 ms
  - DO → browser for the first 4 × 36 KB: ~20–60 ms
  - decode, worklet and output: ~30–60 ms
  - **≈0.1–0.2 s in all**
- **Framing**, shared end to end: `u8 type | u8 stem | u32 epoch-or-offset | u32 length | payload`.
  - `HEADER` (JSON: stems, samplerate, channels, bitrate, gain, durationHint, title)
  - `DATA`, `STEM_END`
  - `END` (JSON: gains, rescaled)
  - `RESET` (new epoch), `ABORT`
  - `KEEPALIVE`, every 15 s, for slow link downloads
- **DO behaviour:**
  - Per-stem chunk lists in memory.
  - One pump per reader, always sending from the stem with the smallest sent offset, up to 32 KB at a time, with `writer.ready` backpressure.
  - Memory cap of ~64 MB (128 MB isolate limit); over it, drop chunks every reader has received.
  - An alarm clears it ~2 min after `END`.
  - `new_sqlite_classes`, no storage used. About $0.00003 a song.

## 2. Format and decoder

- **Raw MP3 frames from the existing LAME stream.**
  - MPEG-1 Layer III, 44.1 kHz, 192 kbps CBR, 1152 samples a frame.
  - A ~60-line parser (`mp3-frames.ts`) gives a frame index, so frame k starts at sample k·1152.
  - Encoder delay is the same in stream and file, so a splice by frame index is aligned.
- **MSE `audio/mpeg`, for the record:**
  - Firefox needs mp3-in-fMP4.
  - ManagedMediaSource needs `disableRemotePlayback = true`.
  - Chrome caps an audio SourceBuffer at ~12 MB.
  - All moot if Safari won't route MSE into Web Audio.
- **fMP4/AAC:** rejected. Four more encoders on a 4-core box where LAME already sets the pace.
- **Decoder: `mpg123-decoder`** (MIT, wasm-audio-decoders, ~100 KB) in a module Worker. **New dependency: needs approval.**
  - It's stateful, so arbitrary byte splits decode exactly, with the same sample counts in every browser.
  - Without the dependency: `decodeAudioData` on an `OfflineAudioContext` over frames [k−2, k+N), dropping priming frames. Needs per-browser calibration.

## 3. Keeping the four stems in sync

| | 4 media elements fed by MSE | **One AudioWorklet node, 4 outputs** (pick) |
|---|---|---|
| Safari / iOS | Silent or unrouted through `createMediaElementSource`. iOS 17.1+ only. | Safari 14.1+ and iOS 14.5+ |
| Sync | Four clocks; one stalled stem drifts | One playhead; sample-exact |
| Seek past what's arrived | `waiting`, gated by hand | Silence plus a `starved` message, then resumes on its own |
| Speed | `playbackRate` | Playhead steps by `rate` with Hermite interpolation; pitch moves with speed as today |
| Loop | The 20 ms timer | Sample-accurate |
| Work | Less | ~700–900 lines of TypeScript |

**The live path:**
- **The AudioContext** is still created once, now with `{ sampleRate: 44100 }`.
- **`AudioEngine.prime()` runs synchronously in the Split click:** `getContext()`, `resume()`, `audioWorklet.addModule(...)`, and `navigator.audioSession.type = "playback"` where it exists, for iOS's silent switch.
- **Data path:** `live.ts` reads the fetch, parses frames, stores bytes per stem and forwards them to `live-decoder.worker.ts`.
  - The worker keeps one mpg123 decoder per stem and decodes ahead to playhead+20 s.
  - It posts planar Float32 blocks `{stem, startSample, gainNorm}` straight to the worklet over a `MessageChannel`.
- **Graph per stem:** worklet output i → a `trim` GainNode (1/header.gain) → the existing stem gain → analyser → bus. Restore gain moves from `applyGain` into per-source trims.
- **Start:** `loadLive` resolves once each stem has ≥1.5 s decoded.
- **Duration:** `header.durationHint` at first (`soundfile.info` for files, yt-dlp's `duration` for links); exact at `END`.
- **Seek:** the playhead moves and the decoder re-primes at frame ⌊t·44100/1152⌋−2. If the bytes aren't there yet, the worklet starves and `store.buffering` shows it.
- **Loop:** `setLoop` posts start and end to the worklet.
- **Recorder:** unchanged, but paused while the worklet is starved.
- **currentTime:** extrapolated from `{pos, ctxTime}` posts every ~50 ms.

## 4. Handover to the finished files

| Case | At "ready" | Audible? |
|---|---|---|
| Stem complete, not rescaled | Nothing; the received bytes are the R2 file | No |
| Stream died mid-way | Range-GET R2 from the received byte offset into the same decoder | No |
| Rescaled stem | Range-GET R2 from frame k−2, fresh decoder, drop 2 frames, `gainNorm = 0.5/g'`, 10 ms crossfade | No level step |
| `RESET` after playback began | Keep epoch-0 PCM, splice epoch-1 (or R2) at the frontier frame with a 10 ms crossfade | Effectively no |

- **Stemsep follow-up (phase 5):** add `StreamingMP3(stream_through_rescale=True)`, so a rescaled stem keeps streaming (hard-clipped above ~+6 dBFS) until the splice and never stalls.
- **Optional move to media elements:** only at a pause or at the end, from Blob URLs of the received bytes. No second download. Never crossfade two engines during playback.

## 5. Failure and fallback

The live path always races today's `pollStatus`; it never replaces it.
- **Browser can't do it** (no `AudioWorklet`, `WebAssembly`, module Worker or streaming body, or the flag is off): no live, and `/api/separate` is sent without `live`.
- **DO unreachable, or nothing arrives before ready:** abort live and fall back to `loadStems(finished.load)`.
- **Modal can't reach the DO:** `data()` becomes a no-op that never blocks LAME, and `timings.live_error` is logged.
- **Stream dies mid-way:** the worklet starves, the browser reconnects with `?from=` offsets, and at ready R2 fills the gaps.
- **Job error after playback started:** stop and show the separate-step error. `remember()` and `setTrackParam()` only run at the real ready.
- **Cache hits, `openTrack`, reload, history:** no live, as today.
- **Deploy order:** an old Modal ignores `live`; a new one streams only when asked. Either order is safe.

## 6. Phases, each shippable on its own

**Phase 0: probes** (half a day, throwaway). They decide the open questions:
1. A DO plus ingest plus GET on a staging Worker, with a Modal function in `region="us"` posting timestamped chunks. Confirms neither direction buffers.
2. A static page decoding four stems with `mpg123-decoder` into the worklet. Test on real iPhones (iOS 15, 17, 18, 26), macOS Safari, Chrome, Firefox and a mid-range Android:
   - RMS on an analyser
   - CPU use
   - the silent switch, with `audioSession`
   - a locked screen
3. Optionally, MSE: `isTypeSupported('audio/mpeg')` and RMS through `createMediaElementSource` on Safari.

**Phase 1: infrastructure, inert:**
- `worker/index.ts` routes `/api/live/<uuid>(/ingest)?` to `env.LIVE` and everything else to vinext. Ingest checks `secretMatches`.
- `worker/live-relay.ts` (the DO) and `app/lib/live-protocol.ts`.
- `wrangler.jsonc`: `main`, a `LIVE` DO binding, a `v1` migration and `LIVE_PLAYBACK: "off"`. Then `pnpm cf-typegen`.
- `tsconfig.cloudflare.json` includes `worker/**/*`. Export `TASK_ID` from `jobs.server.ts`.
- `/api/separate` passes `live: true` only when asked and enabled.

**Phase 2: Modal, inert unless `live=true`:**
- A `_Live` sender in `modal/app.py`: a queue, a thread running the chunked POST, and `header`, `data`, `reset`, `finish(gains, rescaled)`, `abort` and `close`.
- Hook it into `new_encoder(on_data=…)`, the `NotStreamable` reset, `encoder.finish` (before upload, so the browser learns gains early) and the error path.
- Timings `live_first_data`, `live_bytes` and `live_error`. `enqueue` forwards `live`.

**Phase 3: browser, behind a flag:**
- New: `live-support.ts`, `mp3-frames.ts`, `live.ts`, `live-decoder.worker.ts` and `live-processor.ts`.
- `engine.ts`: `prime()`, `attachStem()`, `loadLive()`, `completeLive()`, and a `mode` that the transport methods dispatch on.
- `store.ts`: `live`, `buffering` and `liveLoaded`.
- `Home.tsx` `split()`: prime in the click handler, then open live in parallel with `triggerSeparation(taskId, {live: true})` and race `live.ready` against `separate()`.
- The scrubber draws the loaded frontier and a buffering state.

**Phase 4: completion paths.**
- The R2 gap fill, the rescaled splice and the epoch splice.
- The Blob handover.
- Fault injection.
- Check that the bucket's CORS allows Range GETs.

**Phase 5:** stemsep `stream_through_rescale`, then re-vendor.

**Phase 6:** switch it on, and update AGENTS.md and the handoff notes.

## Measuring

The Playwright harness stops at the fourth `canplay`, but live playback creates no `Audio` elements while it streams.
- **First audible sample, for both paths:** wrap `createDynamicsCompressor` in `addInitScript`, tap the limiter with an `AnalyserNode`, and record the first time RMS > 1e-4.
- **Also record:** `performance.mark`s `live:open`, `live:header`, `live:first-data` and `live:start`.
- **A/B:** `?live=1` against no flag, five warm runs each, joined with Modal's `timings.live_first_data`.
- **Browsers:** Playwright's `webkit` as a check; iPhones by hand with Web Inspector.

## Estimate

| Seconds after Split (4-min song, warm, desktop) | Today | Live |
|---|---|---|
| First progress | 2.9 | 2.9 |
| `separate` starts | ≈3.1 | ≈3.1 |
| First `on_data` | n/a | ≈3.4 |
| Sound | **7.7** | **≈3.5–3.8** |

- **Saving:** ≈4 s (≈50%). The same 4 s for cold GPUs and link songs. More for longer songs, whose encode, upload and report tail grows with length.
- **Cost:** the DO is ~$0.00003 a song. No extra GPU time. The sender thread costs a few tenths of a CPU-second. Modal egress doubles; its pricing isn't confirmed.

**Risks:**
1. Cloudflare buffering chunked ingest; the fallback is a WebSocket.
2. DO memory for 10-minute songs.
3. Worklet and WASM CPU on old phones next to three.js.
4. Hermite resampling is a little rougher than the media element's at 0.5×/1.5×.
5. iOS needs `prime()` inside the gesture, and `audioSession` (16.4+) for the silent switch.
6. Two playback engines until media elements are retired.
7. A new dependency.
8. The WebKit bug status is unverified on a device.
9. Playback can start on a job that later fails.
