# KLING-MOTION

Kling-Motion — an AI motion control video generator that proxies Magnific / Freepik's Kling motion-control endpoints.

> motion control generator by **Kang Rebahan** · [follow FB: Kang Rebahan](https://www.facebook.com/ahmat.cookies)

## Stack

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS 3.4
- `@vercel/blob` for storing reference image + reference video
- Magnific / Freepik Kling endpoints:
  - `kling-2.6-std` · `kling-2.6-pro`
  - `kling-3-std` · `kling-3-pro`

## How it works

1. User pastes their Magnific / Freepik API key in the UI (it is **not stored** on the server, only forwarded per-request).
2. User picks a reference image (≤ 15 MB) and a reference video (≤ 100 MB). The browser uploads them **directly** to Vercel Blob using `@vercel/blob/client`'s `upload()`; `/api/upload` is just the token-vending endpoint. This avoids Vercel's ~4.5 MB serverless body limit so the full sizes promised in the UI actually work.
3. `/api/generate` posts the public blob URLs to the selected Kling motion-control endpoint with the user's API key, returning a `taskId`.
4. The client polls `/api/task-status` every 5 s for up to 20 minutes. The route follows status / result / data shapes and surfaces the resulting video URL.
5. As soon as a final URL is found (or on error / timeout), `/api/delete-blob` removes the uploaded reference media.

## Environment

Add a Vercel Blob store to the project, **with access set to `Public`** (Magnific needs to fetch the URLs you pass it). Vercel injects `BLOB_READ_WRITE_TOKEN` automatically; for local dev set it in `.env.local`:

```
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxx
```

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Deploy

The easiest path is Vercel:

1. Push this repo to GitHub.
2. Import it on [vercel.com/new](https://vercel.com/new).
3. Add a Blob store to the project (Storage → Create → Blob).
4. Deploy.

## Disclaimer

This is an unofficial UI for the public Magnific / Freepik Kling motion-control APIs. You bring your own API key and pay your own provider quota.
