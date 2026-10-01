# stemplayer

A browser replica of the Stem Player device. Upload a song, it's separated into 4 stems (vocals, drums, bass, other) by Demucs on a serverless GPU, and you mix them in real time by dragging LED sliders on a photorealistic circular device.

Read `PLAN.md` for the full build plan and component specs.

Data flow: upload → R2 (presigned PUT) → `api.separate` → Modal GPU (Demucs) → webhook → KV job status → client polls `api.status` → `api.stems` serves stem URLs → Web Audio API.

A YouTube link skips the upload: `api.link` checks the link (oEmbed gives the title) → `api.separate` → the Modal job downloads the audio with yt-dlp, then carries on as above. Repeat videos reuse their stems via a `yt:` index in KV.

## Commands

```sh
pnpm dev          # secrets from 1Password (.env.op), plus a webhook tunnel for Modal
pnpm dev:ui       # UI only: no secrets, so upload and separation won't work
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm run deploy
pnpm wrangler tail
modal deploy modal/app.py
```

## Stack — do not swap without asking

**Not Next.js and not Vercel.** Do not apply `next16-app` hosting defaults. Follow `cf-workers`.

- React Router 7 in framework mode (`react-router.config.ts`, `app/routes.ts`). No App Router, no RSC, no `'use client'`.
- Cloudflare Workers — `workers/app.ts` wraps the React Router handler. wrangler + `@cloudflare/vite-plugin`.
- R2 (`AUDIO_BUCKET`) for uploads and stems; KV (`JOBS`) for job status.
- Modal (`modal/app.py`) runs Demucs 4.0.1 on GPU.
- Three.js via `@react-three/fiber` + drei; zustand; framer-motion; aws4fetch.
- Tailwind v4 via `@tailwindcss/vite`. No shadcn/ui.
- pnpm.

## Styling

The design system lives in the `@theme` block of `app/app.css`. Tailwind's default colour, type and radius scales are switched off, so only these tokens exist:

- Text: `text-wordmark`, `text-display` (headlines, song title), `text-body`, `text-caption`, `text-micro` (caps labels). Each sets its own line height and tracking.
- Colour: `page`, `raised`, `ink`, `ink-muted`, `line`, `line-strong`, `well`, `led-cyan`, `led-magenta`, `cyan-ink` (on), `magenta-ink` (focus, errors), `record`.
- Radius: `rounded-panel`, `rounded-row`, `rounded-key`, `rounded-full`.
- Buttons: `btn-primary`, `btn-secondary`, `btn-icon`.

Use classes, not inline `style` or arbitrary values like `text-[13px]`. If nothing fits, add a token to `app.css` first.

## Hard rules

- Audio state lives in zustand, never in React state. Never re-create the `AudioContext`.
- Secrets are wrangler secrets, not vars: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WEBHOOK_SECRET`.
- Verify the webhook secret in `api.webhook.ts` against `WEBHOOK_SECRET`. The same secret is the bearer token the Worker sends to Modal (Modal secret `stemplayer-webhook`).
- The browser never talks to Modal directly.
- Uploads go straight to R2 via presigned URL, not through the Worker.
- KV is eventually consistent — poll with backoff.
- Do not hand-edit `worker-configuration.d.ts`.
