# stemplayer

A browser replica of the Stem Player device. Upload a song, it's separated into 4 stems (vocals, drums, bass, other) by Demucs on a serverless GPU, and you mix them in real time by dragging LED sliders on a photorealistic circular device.

Read `PLAN.md` for the full build plan and component specs.

Data flow: upload → R2 (presigned PUT) → `/api/separate` → Modal GPU (Demucs) → webhook → KV job status → client polls `/api/status` → `/api/stems` serves stem URLs → Web Audio API.

Loading the page wakes the Modal API (`/api/wake` → its `/health`), a small container that sleeps after 20 idle minutes and takes 3–6 s to start. Picking a song also asks Modal to start a GPU container (`app/lib/warm.server.ts` → the Modal API's `/warm`), so it boots while the song uploads or is looked up. Modal starts at most one a minute however often it's asked.

A song link skips the upload: `/api/link` parses it (`app/lib/links.ts`) and looks it up (`app/lib/links.server.ts`) → `/api/separate` → the Modal job fetches the audio with yt-dlp, then carries on as above.

- YouTube and SoundCloud are downloaded directly; oEmbed gives the title, and for SoundCloud the numeric track ID.
- Spotify and Apple Music are DRM-protected, so the job searches YouTube for the artist and title and keeps a result within a few seconds of the song's length. Apple's metadata comes from the iTunes Lookup API. Spotify's comes from the `__NEXT_DATA__` on its embed page, which is not a published API and can break without warning.
- YouTube refuses most of Modal's shared cloud IPs ("Sign in to confirm you're not a bot"), whatever the yt-dlp client or PO token. When it does, the job falls back to the Apify actor `lurkapi~youtube-to-mp3-audio-downloader` with residential proxies, which returns a link to the audio file. It needs the Modal secret `stemplayer-apify` (`APIFY_TOKEN`) and costs about a cent per song.
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
- Cloudflare Workers — `wrangler.jsonc` points `main` at vinext's `vinext/server/fetch-handler`. Route handlers read bindings with `import { env } from "cloudflare:workers"`. wrangler + `@cloudflare/vite-plugin`.
- `pnpm typecheck` runs `vinext typegen`, which writes `next-env.d.ts` and `.next/types` (`RouteContext<"/api/...">`). Both are generated and gitignored.
- R2 (`AUDIO_BUCKET`) for uploads and stems; KV (`JOBS`) for job status.
- Modal (`modal/app.py`) runs Demucs 4.0.1's `htdemucs` on an A10 through stemsep, a faster runner for it, vendored at `modal/stemsep/` from the private repo `dawsonxiong/stemsep`. Don't edit the vendored copy: change stemsep, then run its `scripts/vendor.sh ../stemplayer/modal/stemsep`. Its benchmarks and the reasons behind `SEPARATOR_CONFIG` live there.
- Three.js via `@react-three/fiber` + drei; zustand; framer-motion; aws4fetch.
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

- Audio state lives in zustand, never in React state. Never re-create the `AudioContext`.
- Secrets are wrangler secrets, not vars: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WEBHOOK_SECRET`.
- Modal secrets: `r2-creds`, `stemplayer-webhook` (`WEBHOOK_SECRET`), `stemplayer-apify` (`APIFY_TOKEN`). A missing one fails the Modal deploy.
- Verify the webhook secret in `app/api/webhook/route.ts` against `WEBHOOK_SECRET`. The same secret is the bearer token the Worker sends to Modal (Modal secret `stemplayer-webhook`).
- The browser never talks to Modal directly.
- Uploads go straight to R2 via presigned URL, not through the Worker.
- KV is eventually consistent — poll with backoff.
- Do not hand-edit `worker-configuration.d.ts`.

## Git

- Name branches `dawson/<short-name>`: a few words, kebab-case (`dawson/cache-fix`).
- Commit messages follow Conventional Commits, lowercase: `fix: ...`, `feat: ...`.
