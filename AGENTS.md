# stemplayer

A browser replica of the Stem Player device. Upload a song, it's separated into 4 stems (vocals, drums, bass, other) by Demucs on a serverless GPU, and you mix them in real time by dragging LED sliders on a photorealistic circular device.

Read `PLAN.md` for the full build plan and component specs, and `docs/handoff.md` for the performance work: stemsep, R2 job records, stem gains, GPU prewarm, link downloads on Google Cloud, live playback, and how it was all measured.

Data flow: upload → R2 (presigned PUT) → `/api/separate` → Modal GPU (Demucs) → webhook → job record in R2 → client polls `/api/status` → `/api/stems` serves stem URLs → Web Audio API.

Live playback (behind flags, off by default) plays a song while it's still being separated. It races the flow above and never replaces it:

- The browser opens `GET /api/live/<taskId>` as it posts `/api/separate` with `live: true`. The Worker passes `live` to Modal only when the `LIVE_PLAYBACK` var is `"on"`, and answers `{ live }`.
- Modal's `_Live` (`modal/app.py`) opens a WebSocket to `{webhook origin}/api/live/<taskId>/ingest`, authed with `x-webhook-secret`, and sends each stem's MP3 as LAME makes it (`StreamingMP3(on_data=…)`), then `END` with the gains before the upload. It never blocks the encoders; if the relay can't be reached the job carries on and logs `timings.live_error`.
- `LiveRelay` (`worker/live-relay.ts`), a Durable Object per task, holds the frames in memory and streams them to each reader, interleaved by audio time; a reader resumes with `?from=<offsets>&epoch=<n>`. An alarm clears it 2 minutes after the stream ends.
- The framing is `app/lib/live-protocol.ts`: `u8 type | u8 stem | u32 value | u32 length | payload`, little-endian. Types: `HEADER`, `DATA` (value: byte offset), `STEM_END` (value: length), `END`, `RESET` (value: new epoch, when a song is separated again whole), `ABORT`, `KEEPALIVE`. `_Live` packs the same layout.
- In the browser, `LiveSession` (`app/lib/audio/live.ts`) reads the stream, `live-decoder.worker.ts` decodes it with `mpg123-decoder` and posts PCM to one AudioWorklet node (`live-processor.ts`) with an output per stem, through the same gain → analyser → bus → effects → master → limiter graph. `AudioEngine.mode` is `"live"` then; seek, speed, loop and the recorder work in both modes.
- At "ready", `AudioEngine.completeLive` keeps playing: a stem that streamed whole is its file already; one cut short is filled from its R2 file with a Range GET; one that was rescaled, or whose file doesn't match what streamed, carries on from the file at the frame decoding had reached. If any of that fails, `handOver` switches to the media files at the same position.
- It's on: `LIVE_PLAYBACK: "on"` in `wrangler.jsonc` (server), and on by default in the browser where it's supported (`app/lib/audio/live-support.ts`). `?live=0` or `localStorage["stemplayer:live"] = "0"` turns it off in one browser; `LIVE_PLAYBACK: "off"` turns it off for everyone, and the browser then waits for the files as before.

Loading the page wakes the Modal API (`/api/wake` → its `/health`), a small container that sleeps after 20 idle minutes and takes 3–6 s to start. Picking a song (choosing, dropping or pasting it, before Split) also asks Modal to start a GPU container (`/api/warm` → `app/lib/warm.server.ts` → the Modal API's `/warm`), so it boots while the person presses Split and the song uploads or is looked up. Modal starts at most one a minute however often it's asked.

A song link skips the upload: `/api/link` parses it (`app/lib/links.ts`) and looks it up (`app/lib/links.server.ts`) → `/api/separate` → the Modal job has `fetch_link`, a small CPU function on Google Cloud, download the audio with yt-dlp, then carries on as above. Link audio that libsndfile can't read (YouTube's Opus and AAC) streams into separation through ffmpeg.

- YouTube and SoundCloud are downloaded directly; oEmbed gives the title, and for SoundCloud the numeric track ID.
- Spotify and Apple Music are DRM-protected, so the job searches YouTube for the artist and title and keeps a result within a few seconds of the song's length. Apple's metadata comes from the iTunes Lookup API. Spotify's comes from the `__NEXT_DATA__` on its embed page, which is not a published API and can break without warning.
- YouTube asks containers on AWS, Azure and Oracle (where Modal's A10s run) to sign in for many videos ("Sign in to confirm you're not a bot"), whatever the yt-dlp client or PO token. It refuses Google Cloud far less often outside its Ashburn region: on 2026-10-09 production's `fetch_link` was refused once for a video it downloaded minutes later from another container. So `fetch_link` runs on `cloud="gcp"`, `region="us-central"`. Refusals follow the address, and containers in one region often share one, so when it's refused, stand-ins in us-east, us-west and eu-west (`fetch_link_east`, `_west`, `_eu`) try at once and the first download wins; a refused container takes no more songs. Pasting a YouTube, Spotify or Apple Music link warms the stand-ins (`/api/warm?youtube=1` → the Modal API's `/warm?youtube=1`), so a refused song gets one in ~2.5 s instead of ~6 s cold. Refusals follow the address and drift over time; on 2026-10-11 us-central, us-west and eu-west let 12 of 12 containers through, us-east 2 of 4, and Tokyo and Singapore none, so don't add Asian regions. Neither a newer yt-dlp, PO tokens nor IPv6 (Modal containers have none) gets past a refused address. `.github/workflows/bump-yt-dlp.yml` proposes a yt-dlp bump every Monday, since YouTube's changes break old versions in other ways (403s, missing formats). When every one is refused, `fetch_link_proxy` tries through IPFoxy's rotating residential proxy (`PROXY_URL`, as `http://user:pass@host:port` or `host:port:user:pass`, best through its US gateway `gate-us.ipfoxy.io`): two sticky sessions race, a third joins at 15 s, 60 s at most. A session keeps one home address so the lookup and the download match, as YouTube requires. On 2026-10-12, 6 of 8 sessions got a refused video in 4.2–6.5 s. yt-dlp is silenced through the proxy, since its errors can carry the proxy URL and password. When that fails too, it falls back to the Apify actor `lurkapi~youtube-to-mp3-audio-downloader` with residential proxies, which returns a link to the audio file. That takes 44–168 s and 5–8.5¢ a song, and the Apify account is capped at $5 a month. It needs the Modal secret `stemplayer-apify` (`APIFY_TOKEN`).
- Modal only ever gets IDs or search terms, never a URL to fetch.
- Repeat songs reuse their stems via a `link:<version>:<provider>:<id>` index in KV.

## Commands

```sh
pnpm dev          # secrets from 1Password (.env.op), plus a webhook tunnel for Modal
pnpm dev:ui       # UI only: no secrets, so upload and separation won't work
pnpm preview      # production build served by workerd
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm run deploy
pnpm wrangler tail
modal deploy modal/app.py
```

## Stack — do not swap without asking

**vinext, not Next.js, and not Vercel.** vinext reimplements the Next.js 16 API on Vite 8; the `next` package is not installed. Do not apply `next16-app` hosting defaults. Follow `cf-workers`.

- App Router via vinext (`vinext()` in `vite.config.ts`). `app/layout.tsx` and `app/page.tsx` are server components; the player is one client tree under `app/components/Home.tsx` (`"use client"`). API endpoints are route handlers in `app/api/**/route.ts`, not server actions.
- Cloudflare Workers — `wrangler.jsonc` points `main` at `worker/index.ts`, which routes `/api/live/<taskId>` and `/api/live/<taskId>/ingest` to the `LIVE` Durable Object (`LiveRelay`, migration `v1`, SQLite-backed but storing nothing) and hands everything else to vinext's `vinext/server/fetch-handler`. Durable Objects must be exported from that file. Route handlers read bindings with `import { env } from "cloudflare:workers"`. wrangler + `@cloudflare/vite-plugin`.
- `pnpm typecheck` runs `vinext typegen`, which writes `next-env.d.ts` and `.next/types` (`RouteContext<"/api/...">`). Both are generated and gitignored.
- R2 (`AUDIO_BUCKET`) for uploads, stems and job records (`stems/<taskId>/job.json`, via `app/lib/jobs.server.ts`); KV (`JOBS`) for the stem cache index and rate limits. The bucket's lifecycle rules, set on the bucket rather than in code, expire `stems/` (job records included) after 14 days and `uploads/` after 1.
- Modal (`modal/app.py`) runs Demucs 4.0.1's `htdemucs` on an A10 through stemsep, a faster runner for it, vendored at `modal/stemsep/` from `dawsonxiong/stemsep`. Don't edit the vendored copy: change stemsep, then run its `scripts/vendor.sh ../stemplayer/modal/stemsep`. Its benchmarks and the reasons behind `SEPARATOR_CONFIG` live there.
- Three.js via `@react-three/fiber` + drei; zustand; framer-motion; aws4fetch; `mpg123-decoder` (WASM MP3 decoding for live playback, in a Worker).
- Tailwind v4 via `@tailwindcss/vite`. No shadcn/ui.
- pnpm.

## Styling

The design system lives in the `@theme` block of `app/app.css`. Tailwind's default colour, type and radius scales are switched off, so only these tokens exist:

- Text: `text-wordmark` / `text-wordmark-compact` (phones), `text-headline` (song title on phones), `text-display` (headlines, song title), `text-body`, `text-caption`, `text-micro` (caps labels). Each sets its own line height and tracking.
- Colour: `page`, `raised`, `ink`, `ink-muted`, `line`, `line-strong`, `well`, `led-cyan`, `led-magenta`, `cyan-ink` (on), `magenta-ink` (focus, errors), `record`.
- Radius: `rounded-panel`, `rounded-row`, `rounded-key`, `rounded-full`.
- Buttons: `btn-primary`, `btn-secondary`, `btn-icon`.

Use classes, not inline `style` or arbitrary values like `text-[13px]`. If nothing fits, add a token to `app.css` first.

## Hard rules

- Audio state lives in zustand, never in React state. Never re-create the `AudioContext`. With live playback it's created in the Split click by `AudioEngine.prime()`, at 44.1 kHz, which iOS needs to start audio and to play through the silent switch.
- A `fetch` of a stem URL an `<audio>` element is already loading waits for that load in Chrome: use `cache: "no-store"` (as `completeLive` does).
- Secrets are wrangler secrets, not vars: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WEBHOOK_SECRET`.
- Modal secrets: `r2-creds`, `stemplayer-webhook` (`WEBHOOK_SECRET`), `stemplayer-apify` (`APIFY_TOKEN`), `stemplayer-proxy` (`PROXY_URL`). A missing one fails the Modal deploy.
- Verify the webhook secret in `app/api/webhook/route.ts` against `WEBHOOK_SECRET`. The same secret is the bearer token the Worker sends to Modal (Modal secret `stemplayer-webhook`).
- The browser never talks to Modal directly.
- Uploads go straight to R2 via presigned URL, not through the Worker.
- `/api/status/<id>?since=<status>:<progress>` long-polls: the Worker re-reads the R2 record every 250 ms and answers when it changes (or after 20 s), and the client asks again.
- Stems are stored 6 dB down (`STEM_GAIN` in `modal/app.py`) and the job reports each stem's stored gain (`stem_gains` → `stemGains` on the job → `gains` from `/api/stems`). `AudioEngine` plays each stem at 1 / its gain, so the stems add up to the song. Jobs from before have no gains and play as stored.
- Job records live in R2, not KV. KV caches each key per location for up to a minute, so status written where Modal's webhook lands reached a person elsewhere 7–50 s late. KV is fine for the cache index and rate limits, where staleness costs nothing.
- Do not hand-edit `worker-configuration.d.ts`.

## Git

- Name branches `dawson/<short-name>`: a few words, kebab-case (`dawson/cache-fix`).
- Commit messages follow Conventional Commits, lowercase: `fix: ...`, `feat: ...`.
