# Making Stem Player fast

*October 2026*

Splitting a song in Stem Player previously took about a minute from the moment the user pressed Split to the moment the stems began playing. That time is now 6–9 seconds, and with live playback enabled, audio begins after roughly 1.5 seconds.

The work spanned two repositories: [stemplayer](https://github.com/dawsonxiong/stemplayer), the application, and [stemsep](https://github.com/dawsonxiong/stemsep), the optimized Demucs runner it depends on.

## Results

All figures are medians, measured from Toronto, covering the interval from pressing Split until all four stems are playing in the browser.

| | Before | After |
|---|--:|--:|
| Warm split, 4 min MP3 | 60.6 s | 7.6 s |
| Cold split | 59.9 s | 9.3 s |
| First sound, with live playback | – | 1.5 s |
| YouTube link refused by YouTube | 47.6–60.8 s | 9.4–21.1 s |
| GPU job alone | 18.4 s | 5–6 s |
| Cost per song | 0.54¢ | ~0.15–0.30¢ |

These gains came at no cost to output quality. Across 12 tracks from MUSDB18-HQ, stemsep's results are within 0.02 dB SDR of the reference Demucs implementation.

## What changed

### Job status latency

The largest share of the original delay was not separation but status reporting. Job records were stored in Workers KV, which caches values for up to 60 seconds per location, so the browser could continue to see a job as pending well after it had completed. Records are now stored in R2, and `/api/status` long-polls them. The browser is notified approximately 0.25 seconds after a job finishes.

### Separation speed

stemsep uses the same `htdemucs` weights but runs them in fp16, processing eight chunks per pass with 10% overlap. It also encodes each stem to MP3 as soon as it leaves the GPU, rather than waiting for the full job to complete. On an A10, separation time fell from 5.47 s to 1.88 s.

### Startup latency

Several changes reduce the time spent before separation begins. The GPU is now pinned to a US region; Modal had previously been scheduling it in Frankfurt. The page wakes the Modal backend on load, selecting a song warms a GPU, and the upload begins when the file is selected rather than when Split is pressed. Each deployment also pre-warms the memory snapshots.

### Live playback

During separation, the GPU job streams each stem's MP3 frames over a WebSocket to a Durable Object, which relays them to the browser. An AudioWorklet plays all four stems in sync while separation is still in progress, then transitions to the completed files without an audible gap.

### Link downloads

YouTube rejects requests from many cloud IP ranges. Downloads now run on Google Cloud, and when a request is refused, fallback instances in three other regions attempt the download in parallel. If those also fail, the system falls back to a residential proxy and then to a paid Apify actor. The proxy's data allowance is currently exhausted, so it detects this and skips itself within about 2 seconds.

## Approaches evaluated and rejected

The following were tested and not adopted:

- `torch.compile`
- ONNX and TensorRT
- GPU memory snapshots
- T4 GPUs, due to 17.5 s cold starts
- VBR encoding and custom LAME builds
- Multipart stem uploads
- A Media Source Extensions player, which produced no audio on iPhone
- Chunked POSTs to the relay, since Cloudflare buffers the request body
- Retrying refused downloads within the same region

## Open issues

**Upload time on slow connections.** Upload is now the dominant cost for users with limited bandwidth: approximately 15 s on a 25/5 Mbps connection and 30 s on poor mobile networks. Once the upload completes, the remaining pipeline takes about 6.5 s. Two candidate fixes are beginning separation while the upload is still in progress, and compressing WAV and FLAC files in the browser before upload.

**Clipping on loud tracks.** When a stem clips early in the track, streaming stops for that stem and playback falls back to the completed files. This is addressed in Phase 5 of the live playback plan.

**Apify usage cap.** Apify's $5 monthly limit covers roughly 60–80 refused songs. This becomes relevant only if the regional fallbacks prove insufficient.

**Firefox support.** Live playback has not yet been tested in Firefox.

## Further reading

Full implementation details, measurements and known pitfalls are documented in stemplayer's [`docs/handoff.md`](https://github.com/dawsonxiong/stemplayer/blob/main/docs/handoff.md). Benchmarks and raw data are available in stemsep's [README](https://github.com/dawsonxiong/stemsep#readme) and [`results/`](https://github.com/dawsonxiong/stemsep/tree/main/results).
