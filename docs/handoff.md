# Handoff: performance work (2026-10-08 to 2026-10-11)

## Where things stand
Everything below is merged into `main` and deployed by CI.
- **First pass** (#6, #7, #8): stemsep on an A10, job records in R2, stems stored 6 dB down.
- **Second pass** (#10–#17): measured against the old stack in real browsers, then:
  - the GPU is pinned to the US;
  - uploads start when a song is picked;
  - links download on Google Cloud;
  - songs play while they separate (live playback), which is on in production.

Other places:
- **stemsep** (`dawsonxiong/stemsep`): the separation engine and every benchmark. It's vendored at `modal/stemsep/`; change it there and run its `scripts/vendor.sh ../stemplayer/modal/stemsep`. Never edit the vendored copy. Its README's "Fourth pass" covers the browser measurements behind this pass.
- **Plans:** `docs/plans/progressive-playback.md` is the live playback plan and its phase-0 probe results. Phase 5 is still open.
- **Leftover branches:**
  - `dawson/fetch-on-cpu` on GitHub: a dropped experiment, safe to delete.
  - `dawson/transport-buttons`, local only: the owner's unfinished quieter-transport-button styling, not pushed.
- **No test infrastructure is running.** The bench Workers, their KV namespaces and Modal apps, and the live-playback probe were all deleted. "Measuring" below says how to bring a bench back.

## What a split takes now
Split → all four stems playable in the browser. Medians unless noted; all from Toronto.

| | Old stack (387164c) | Now |
|---|---|---|
| Warm upload, 4 min MP3 | 60.6 s | 7.6 s production (n=2), 6.4 s on a pinned bench |
| Cold upload | 59.9 s | 9.3 s |
| First sound, with live playback | n/a | 1.5 s warm in Chromium (5.9 s without it) |
| YouTube link that YouTube refused | 47.6–60.8 s, via Apify | 9.4–21.1 s, via another region |

- **Old stack:** most of its ~60 s was KV caching the job status for a minute.
- **Live playback:**
  - The agent's runs gave a median of 1.49 s (1.36–1.59) against 5.94 s.
  - After rebasing onto #14 it was 2.9 s against 9.2 s, on a colder, differently placed bench.
  - On production right after turning it on: 6.8 s to sound, files ready at 11.4 s, with the GPU still cold from the deploy.

**Uploads are now bound by the person's uplink.** Simulated conditions, 3 splits each, 10 MB MP3 unless noted (`stemsep/results/browser/matrix.jsonl`):

| Condition | Upload done | Playable |
|---|---|---|
| Fast connection | before Split | 6.4–6.9 s |
| Home 50/20 Mbps | 2.8 s | 9.4 s |
| Same, Split 5 s after picking | before Split | 6.7 s |
| 4G 20/8 Mbps, or a phone with a 4× slower CPU | 8.8–8.9 s | 15.4–15.6 s |
| Slow home 25/5 Mbps | 15.0 s | 21.9 s |
| Poor mobile 5/1.5 Mbps (5.9 MB) | 30.2 s | 37.0 s |
| Home, 45 MB WAV | 17.4 s | 24.5 s |

- Once the upload is in, the rest takes ~6.5 s whatever the latency, CPU or browser.
- These runs predate live playback. With it, sound comes ~4 s sooner, but never before the upload is done.

## Second pass, PR by PR
- **#10 `region="us"`, upload on pick, snapshots after deploy.**
  - **GPU placement:** left to choose, Modal put the A10 in Frankfurt, far from the bucket and the webhook. Warm splits went from 10.4 s to 8.4 s once pinned (+15% per GPU-second, ~0.03¢ a song).
  - **Upload on pick:** the R2 upload starts when a file is picked (`uploadPicked` in `app/lib/api.ts`), and replacing or removing the file aborts it. At 20 Mbps up with Split pressed 2 s after the pick: 10.9 s → 8.8 s.
  - **Snapshots after deploy:** a deploy discards the GPU's memory snapshots, and Modal keeps one per kind of machine. The first split after a deploy had waited 18 s. The deploy workflow now warms 6 containers at once (`warm(hold=20)`, ~20¢). That covers most of the snapshots, not all.
- **#11 links on Google Cloud.**
  - **Why:** Modal's A10s run on Oracle, where YouTube asks most containers to sign in, and every refusal went to Apify (44–168 s, 5–8.5¢ a song, account capped at $5 a month). Links now download in `fetch_link`, a 1-CPU function on `cloud="gcp"`, `region="us-central"`.
  - **SoundCloud:** one-file formats come first (`bestaudio[protocol^=http]`), and HLS fragments download 8 at a time. Downloads went from 0.9–8.4 s (one took 22 s) to 0.07–1.1 s.
  - **Streaming decode:** link audio that libsndfile can't read (Opus, AAC/m4a) is stream-decoded through ffmpeg (`_ffmpeg_blocks`), bit-identical to `decode`.
- **#12 logs why a song falls back to decoding whole** (`not_streamable` in the job log). One Apify `.m4a` did this once in production. Fragmented and plain m4a stream fine locally, so check those logs if it happens again.
- **#13 (layout):** the device stays centred once a song's title appears.
- **#14 retries refused YouTube downloads in other regions.**
  - **Why:** refusals follow the IP address, and containers in one region often share one. us-central refused two videos on 2 of 3 containers, while us-east and eu-west let 3 of 3 through.
  - **How:** when `fetch_link` is refused, `fetch_link_east`, `_west` and `_eu` try at once. Only an actual download wins, not another error. A refused container takes no more songs (`stop_fetching_inputs`).
  - **403s:** a YouTube 403 on the audio itself also counts as a refusal.
  - **Apify** only runs if every region is refused.
- **#15 (Safari):** the vignette only shows on wide screens. It darkened the page against Safari's bars on iPhone, which showed as a line (checked in the iOS simulator).
- **#16 live playback**, phases 1–4 of the plan; **#17 turns it on.**
  - **Modal → relay:** the GPU job streams each stem's MP3 frames over a WebSocket (`_Live` in `modal/app.py`) to `LiveRelay`, one Durable Object per task (`worker/live-relay.ts`, routed by `worker/index.ts`).
  - **Relay → browser:** the browser reads them as one streaming GET, interleaved by audio time (`app/lib/audio/live.ts`), and decodes them with `mpg123-decoder` in a worker (`live-decoder.worker.ts`). One AudioWorklet plays all four stems in step (`live-processor.ts`).
  - **At "ready":** a stem that streamed whole is already its file, and one cut short is filled from R2 with a Range GET. A rescaled stem is spliced from its new encoding at the current frame. If anything fails, playback switches to the media elements at the same spot (`completeLive` and `handOver` in `engine.ts`).
  - **Checked on the bench:**
    - a real iPhone (iOS 26.6), including silent mode and a locked screen;
    - a loud song whose drums had to be re-encoded mid-song;
    - no AudioWorklet, as on old browsers, which falls back to today's player;
    - a job failing after playback started: it stops and shows the error.
  - **Firefox is untested.** Playwright's Firefox can't start its content processes on this Mac.
  - **To switch it off:** `LIVE_PLAYBACK: "off"` in `wrangler.jsonc` turns it off for everyone, and `?live=0` for one browser.

## First pass (#6–#8)
**stemsep**, the engine:
- `model.py` splits `HTDemucs.forward` into fp32 `pre` (STFT, normalisation), `Core` and fp32 `post` (mask, iSTFT), so only `Core` changes per backend.
- `engine.py` batches chunks 8 to a pass under fp16 autocast with 10% overlap, cross-faded with demucs's window.
  - `sink=` streams finished stretches, and `first_batch=2` gets the first one out sooner.
  - `separate_stream` separates while the song is still decoding.
- `audio.py`:
  - `decode` and `decode_blocks` (libsndfile, ffmpeg fallback);
  - `StreamingMP3`, which encodes with LAME q5 at 192 kbps as stems come off the GPU, with `gain=`, `gains`, `rescaled` and the `on_data` hook that live playback uses.
- Quality: within 0.02 dB SDR of demucs on 12 MUSDB18-HQ songs.

**stemplayer:**
- **Modal:** A10 with 4 CPUs and 8 GiB, `scaledown_window=60` and a CPU memory snapshot. A background warm-up runs after restore. Stems are stored at `STEM_GAIN = 0.5` and each reports its actual gain.
- **Worker:**
  - job records moved from KV to R2 (`stems/<taskId>/job.json`, ETag-conditional writes), because KV's per-location cache delayed status 7–50 s;
  - `/api/status/<id>?since=` long-polls R2;
  - `/api/wake` and `/api/warm` start the Modal API and a GPU early.
- **Browser:** `AudioEngine` plays each stem at 1 / its gain, through a limiter that only acts above 0 dBFS.
- **Results:**
  - a warm job went from 18.4 s to 5–6 s, and separating alone from 5.47 s to 1.88 s;
  - "ready" reached the browser ~0.25 s after the job finished, instead of 7–50 s;
  - ~0.15–0.30¢ a song.
- **Tried and dropped** (details in stemsep `results/deployed.md`):
  - `torch.compile`, ONNX/TensorRT, GPU memory snapshots, VBR and custom LAME builds;
  - R2 client tweaks, multipart stem uploads, link downloads on a CPU container (in Oracle's cloud, which YouTube refused);
  - T4s, which cold-start in 17.5 s.

## Tried and dropped (second pass)
- **Retrying in the same region:** a fresh container in us-central often lands on the same refused IP. Two videos were refused 4 of 4 times.
- **Preconnecting to the stem host:** stems take ~0.2 s to load after "ready".
- **A Media Source Extensions player:** on iPhone (and Playwright's WebKit), MSE audio passed through `createMediaElementSource` reaches Web Audio as silence.
- **A chunked POST from Modal to the relay:** Cloudflare's edge buffers the whole request body before the Worker runs. WebSocket ingest streams, at ~50 ms from Modal to the browser.
- **One warm-up call after a deploy:** it only takes the snapshot for one kind of machine.

## Open
- **Uploads on slow connections:** the biggest remaining wait (see the table). Options: start separating while the file uploads (chunked presigned PUTs that the job reads as they land), or shrink WAV and FLAC in the browser before sending.
- **Loud songs:** a stem that clips in its first stretch stops streaming, so the song gets no early start and plays from the files. Phase 5 of the plan (`StreamingMP3(stream_through_rescale=True)` in stemsep) fixes that.
- **Rescaled-stem splice:** it downloads the whole stem rather than a Range from the current frame. Rare, and only costs bandwidth.
- **Apify's cap:** $5 a month is ~60–80 refused songs. With the region stand-ins it should rarely run; check `modal app logs stem-demucs` for refusals.
- **YouTube refusals, researched 2026-10-11:**
  - **Per address, all or nothing:** on 24 Google Cloud containers, a refused IP was refused for all 5 gated videos and an accepted one for none. us-central, us-west and eu-west let 12 of 12 through, us-east 2 of 4, Tokyo and Singapore 0 of 8.
  - **What doesn't help:** the newest yt-dlp made no difference, Modal containers have no IPv6, and PO tokens no longer get past the check according to their maintainers.
  - **What's done:** the stand-ins are now warmed when a YouTube link is pasted (2.5 s instead of 6 s), and a weekly workflow proposes yt-dlp bumps. It opens an issue instead of a PR until the repo allows Actions to create PRs.
  - **Residential proxy, since 2026-10-12:** IPFoxy's rotating residential pool, $1.99/GB. It's the step between the region stand-ins and Apify (`fetch_link_proxy`).
    - **Through `gate-us`:** 6 of 8 sessions downloaded a refused video in 4.2–6.5 s; one home address was refused, one errored, and one took 254 s. Two sessions race, a third joins at 15 s, and 60 s is the limit.
    - **Through `gate-sg`:** ~15 s a song.
    - **Apify** now only runs if the proxy fails too.
  - Raw rows are in stemsep `results/youtube-refusals.jsonl`.
- **Real-user timing:** none is collected. Everything here was measured from one Mac with simulated networks.

## Measuring
- **No harness in the repo.** It was a Playwright script in a session scratchpad and is gone. To rebuild it, `stemsep/results/browser/README.md` has what it did. In short:
  - pick a uniquely tagged copy of the song, so the stem cache never hits (`ffmpeg -c copy -metadata comment=<uuid>`);
  - throttle with CDP `Network.emulateNetworkConditions`;
  - count four `canplay` events on wrapped `Audio` elements, or for live playback, RMS on an analyser tapped off the limiter.
- **Bench copy of the app:**
  - Create a KV namespace, then patch a throwaway copy of `wrangler.jsonc`: `name`, the KV id, `MODAL_ENDPOINT` → `https://dawsonxiong--stem-demucs-<name>-separate-api.modal.run`, and `SEPARATIONS_PER_HOUR` → 1000.
  - Deploy Modal with `modal deploy --name stem-demucs-<name> modal/app.py`.
  - Copy the Worker secrets with `op run --no-masking --account my.1password.com --env-file=.env.op -- node -e '…print the three as JSON…' | wrangler secret bulk --name <worker>`. Without `--no-masking`, 1Password replaces the values with `<concealed by 1Password>`.
- **Safari:** the iOS Simulator (iPhone 17 Pro, iOS 26.3) runs real Safari; open URLs with `simctl`.

## Gotchas
- **Old containers after a Modal deploy.** For about a minute after a deploy, Modal keeps sending calls to containers still running the old code. A new argument must be optional on the receiving side, and only passed when it's needed. This caught `warm(hold=…)` and `fetch_link(url, youtube_id)`, and would have caught `separate(live=…)`.
- **macOS has no `timeout`:** use `perl -e 'alarm N; exec @ARGV' cmd`.
- **Wrangler:**
  - `kv` commands use local storage unless given `--remote`.
  - `wrangler delete <name>` takes the name as an argument, so run it outside the repo with `CLOUDFLARE_ACCOUNT_ID` set, or a slip deletes production.
- **Staging Modal:** `modal deploy --name stem-demucs-staging modal/app.py`, then stop the app. Merging to `main` deploys production.
- **Local Worker runs:** `pnpm build`, a dummy `.dev.vars` in `dist/server/`, then `vite preview`.
- **Bench apps** (in stemsep): don't use `from __future__ import annotations` with `modal.parameter`. The shared `images` module has to be shipped with `add_local_python_source`.
