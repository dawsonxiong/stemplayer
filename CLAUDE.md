# CLAUDE.md

Rules for working in this repo. Read `PLAN.md` for the full build plan and component specs.

## What this is

stemplayer — a browser replica of the Stem Player device. Upload a song, it's separated
into 4 stems (vocals, drums, bass, other) by Demucs on a serverless GPU, and you mix them
in real time by dragging LED sliders on a photorealistic circular device.

Data flow: upload → R2 (presigned PUT) → `api.separate` → Modal GPU (Demucs) → webhook →
KV job status → client polls `api.status` → `api.stems` serves stem URLs → Web Audio API.

## Stack — do not swap without asking

Inherits `Developer/CLAUDE.md`, but **deviates on both of its biggest defaults**: this is
not Next.js and not Vercel. Everything below overrides the house stack.

- **React Router 7** in framework mode (`react-router.config.ts`, `app/routes.ts`).
  This is **not** Next.js — no App Router, no RSC, no `'use client'`. Routes are files in
  `app/routes/`, registered in `app/routes.ts`. Ignore Next.js advice.
- **Cloudflare Workers** — `workers/app.ts` wraps the React Router request handler.
  Deployed with wrangler + `@cloudflare/vite-plugin`, not OpenNext.
- **R2** (`AUDIO_BUCKET`) for uploads and stems; **KV** (`JOBS`) for job status.
- **Modal** (`modal/app.py`) runs Demucs 4.0.1 on GPU. Python, deployed separately.
- Three.js via **@react-three/fiber** + **drei**; **zustand** for state; **framer-motion**
  for UI transitions; **aws4fetch** for signing R2 requests.
- **Tailwind v4** via `@tailwindcss/vite`, not the Next plugin. No shadcn/ui here.
- Migrated off npm to pnpm on 2026-08-09; `package-lock.json` is still tracked in git and
  should be removed.

## Hard rules

- **Audio state lives in zustand, never in React state.** The audio graph is imperative
  and runs at frame rate; re-rendering on every slider tick will drop frames. Components
  read from the store; `useAudioEngine` owns the `AudioContext` and the gain nodes.
- **Never re-create the `AudioContext`.** It is created once and reused. Browsers cap the
  number of contexts, and a leaked one silently stops producing sound.
- **Secrets are wrangler secrets, not vars.** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  and `WEBHOOK_SECRET` are set with `wrangler secret put`. Only `MODAL_ENDPOINT` and
  `R2_PUBLIC_ENDPOINT` belong in `wrangler.jsonc` `vars`. Never commit a key.
- **Verify the webhook signature** in `api.webhook.ts` against `WEBHOOK_SECRET` before
  writing job status. It is a public endpoint.
- **The browser never talks to Modal directly.** All GPU calls go through the Worker.
- **Uploads go straight to R2 via presigned URL**, not through the Worker — Workers have a
  request body size limit and audio files exceed it.
- **Job status is KV, and KV is eventually consistent.** Poll with backoff; don't assume a
  write is immediately readable.
- **`worker-configuration.d.ts` is generated** by `pnpm cf-typegen`. Don't hand-edit it;
  regenerate after changing bindings in `wrangler.jsonc`.

## Required behavior

- `pnpm typecheck` runs cf-typegen + react-router typegen + `tsc -b` — run it after
  touching bindings, routes, or loader/action signatures.
- `pnpm lint` and `pnpm format` must be clean before pushing.
- Keep the device render loop allocation-free. No object literals or closures created per
  frame inside `useAnimationFrame`.

## Commands

```bash
pnpm dev            # react-router dev
pnpm typecheck      # cf-typegen + react-router typegen + tsc -b
pnpm lint           # oxlint .
pnpm format         # oxfmt .
pnpm build          # react-router build
pnpm deploy         # build + wrangler deploy
pnpm wrangler tail  # live Worker logs
modal deploy modal/app.py   # redeploy the Demucs GPU function
```
