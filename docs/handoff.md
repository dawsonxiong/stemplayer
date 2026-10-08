# Handoff: separation performance work (2026-10-08)

## Where things stand
- **stemplayer** (`dawsonxiong/stemplayer`): PRs #6 → #7 → #8 are squash-merged into `main` and deployed by CI. Production smoke checks pass; no real song has been split in production since the deploy.
- **stemsep** (`dawsonxiong/stemsep`, private): the separation engine, its benchmarks and results. It's vendored into stemplayer at `modal/stemsep/` with `scripts/vendor.sh ../stemplayer/modal/stemsep`. Never edit the vendored copy; change stemsep and re-vendor.
- **Leftover branch:** `dawson/fetch-on-cpu` is on GitHub, unmerged. It's a measured-and-dropped experiment and is safe to delete.

## stemsep (engine)
- **`model.py`**: splits `HTDemucs.forward` into three parts so only the network changes per backend:
  - `pre`: STFT and normalization, in fp32.
  - `Core`: the encoders, cross-transformer and decoders.
  - `post`: mask and iSTFT, in fp32.
- **`engine.py`, `Separator.separate`**:
  - Chunks are batched (8 per pass) and cross-faded with demucs's triangular window.
  - The network runs under fp16 autocast with 10% overlap; cuDNN autotune is off, because it cost ~12 s of cold start for no gain.
  - `sink=` streams finished stretches as they're done, and `first_batch=2` gets the first stretch out sooner.
  - Backends: `eager` (shipped), `compile`, and `onnx` (`onnx_backend.py`, ORT CUDA/TensorRT, not shipped).
- **`Separator.separate_stream`**: separates while the song is still being decoded.
  - Chunks start at a fixed stride, plus one final chunk flush with the end.
  - It skips the song-level normalization, which was measured to be quality-neutral.
- **`audio.py`**:
  - `decode`: libsndfile for MP3/WAV/FLAC/Ogg, with an ffmpeg fallback that matches demucs's channel mapping. It also falls back to ffmpeg when libsndfile would read a file short.
  - `decode_blocks`: block-wise decoding for streaming. It raises `NotStreamable` when the job should fall back to decoding the whole file.
  - `mp3_bytes`: lameenc at LAME q5, 192 kbps CBR.
  - `StreamingMP3`: encodes while separating, with `gain=` and the resulting `gains`. A stem that would clip stops its streamed encode and is re-encoded whole; those stems are listed in `rescaled`. It also has an `on_data` hook.
- **`bench/`**: Modal benchmark apps for the GPU sweep, end-to-end runs, quality, cold start, encoding, ONNX, VBR, headroom and streaming decode. Every number in stemsep's README traces to a file in its `results/`.

## stemplayer changes
**Modal (`modal/app.py`)**
- GPU A10, 4 CPUs, 8 GiB memory, `scaledown_window=60`. CPU memory snapshot; the GPU memory snapshot was tested and rejected.
- Each container runs a background warm-up separation after restore, overlapping the first song's download.
- Stems are stored at `STEM_GAIN = 0.5` (−6 dB), and the job reports each stem's actual stored gain as `stem_gains`.
- Decoding happens while separating (`decode_blocks` → `separate_stream`, prefetched on a thread), with a fallback to whole-file decoding.
- Progress webhooks go out from a background thread over a keep-alive session, and are drained before the final report. Each job logs and returns per-stage `timings`.
- API: `GET /health` (page-load wake), `POST /warm` (spawns `Separator.warm`, deduplicated to once a minute), and `scaledown_window=1200`.
- Link songs are still downloaded inside the GPU container. Doing it on a separate CPU container was slower.

**Worker**
- Job records moved from KV to R2 at `stems/<taskId>/job.json` (`app/lib/jobs.server.ts`), because KV's per-location caching delayed status 7–50 s.
  - `getJob` falls back to KV; that fallback can be removed after 14 days.
  - Writes are conditional on the ETag.
  - Task IDs must be UUIDs.
- **Stay on KV:** the stem-cache index and rate limits.
- **Expiry:** the bucket's lifecycle rules (set on the bucket, not in code) expire `stems/` after 14 days and `uploads/` after 1 day.
- `/api/status/<id>?since=` long-polls R2, and its ready response includes `load`, built by `app/lib/stems.server.ts`.
- New routes: `/api/wake` and `/api/warm`.
- The webhook stores `stemGains`, and `/api/stems` returns them as `gains`.
- An unreachable Modal now marks the job as an error instead of leaving it processing forever.

**Frontend**
- `AudioEngine` plays each stem at 1 / its gain, and an over-only limiter (`DynamicsCompressorNode`, threshold 0 dBFS) stops loud soloed stems clipping.
- The page wakes the API on load.
- Picking or pasting a song calls `/api/warm` (client-throttled, skipped for playlists) and hashes the file early.
- Link jobs start without waiting for the 1 s lookup display.
- Status uses long-polling, with fallback to 1 s polling.

## Key results (245 s song)
- **Job time:** warm 18.4 s → 5.0–6.0 s; cold 29–33 s → 6.4–8.0 s with the early GPU start.
- **Status delay:** "ready" reached the browser 7–50 s late → ~0.25 s.
- **Separation:** on the A10, 5.47 s → 1.88 s.
- **Quality:** within 0.02 dB SDR of demucs on 12 MUSDB18-HQ songs.
- **Cost:** about 0.54¢ → 0.15–0.30¢ per song. The idle tail went from 8.8¢ to 2.3¢.

## Tried and dropped (details in stemsep `results/deployed.md`)
- **Engine backends:** `torch.compile` compiles for 5–8 minutes. ONNX/TensorRT isn't worth the build time and image size.
- **GPU memory snapshots:** worse cold starts in practice.
- **Encoder settings:** VBR, custom LAME builds, and more CPU cores.
- **R2 tweaks:** ranged downloads, other clients and socket buffers.
- **Link downloads on a CPU container:** slower.
- **Multipart stem uploads:** no gain for songs under ~8 minutes.
- **T4:** 36% cheaper per session, but a median 17.5 s cold start against 5.5 s.

## Open decisions
- Pinning the GPU to `region="us"`: ~0.3–0.6 s per job for a 15% higher price. Default placement can land in Frankfurt or Osaka, while the bucket is in eastern North America.
- A full browser run with real secrets: `pnpm dev` needs 1Password approval.

## Gotchas
- **Staging Modal:** test with `modal deploy --name stem-demucs-staging modal/app.py`, then stop the app afterwards. Merging to `main` deploys to production.
- **Local Worker runs:** use `pnpm build`, then put a dummy `.dev.vars` in `dist/server/` and run `vite preview`.
- **Bench apps:** don't use `from __future__ import annotations` with `modal.parameter`. The shared `images` module has to be shipped with `add_local_python_source`.
