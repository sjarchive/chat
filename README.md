# Chat (Vite + React + Cloudflare Workers)

The original vanilla HTML/CSS/JS chat PWA, rebuilt as **React 19 + TypeScript on Vite** (no framework, no server rendering), deployed to **Cloudflare Workers** as a single worker that serves the static client, relays push notifications (`/api/notify`) and runs the Supabase keep-alive cron. Supabase (auth, database, storage, realtime) is unchanged, and the chat remains 100% client-side — E2EE (ECDH P-256), optimistic sends, realtime, push notifications and PWA behavior all work exactly as before.

## Structure

```
index.html             # shell: pre-paint theme & session script + root div
main.tsx               # entry: mounts <ChatApp/>
globals.css            # the original stylesheet, ported verbatim
components/
  ChatApp.tsx          # orchestrator: state, Supabase calls, realtime, sends
  AuthScreen.tsx       # sign in / sign up
  ChatsScreen.tsx      # chats list + username search
  ChatScreen.tsx       # conversation: header, message list, composer
  MessageRow.tsx       # bubble, swipe-to-reply, encrypted media
  SettingsOverlay.tsx  # display-name modal
  icons.tsx            # shared inline SVGs (ticks, icons)
lib/
  supabase.ts          # client singleton (localStorage sessions, as before)
  crypto.ts            # CircleCrypto — E2EE port
  push.ts              # SW registration + push subscribe/unsubscribe
  media.ts             # attachment compression/size caps before upload
  theme.tsx, fade.ts, viewport.ts, utils.ts, types.ts
worker/
  index.ts             # POST /api/notify — push relay (old worker.js port)
                       # + scheduled: Supabase keep-alive cron
vite.config.ts         # react plugin + NEXT_PUBLIC_ envPrefix
wrangler.jsonc         # worker "chat" (replaces the previous one on deploy)
public/                # sw.js, manifest.json, favicon.svg + PWA icons — copied verbatim
```

Asset routing is assets-first: requests matching a file in `dist/` are served directly by Workers static assets; everything else (any path, since the app is a single page) falls through to the worker and gets the app shell.

## Development

```bash
npm install
npm run dev
```

- Client env lives in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) — already filled with the same public values the old client hardcoded. Vite inlines them at build time (`envPrefix` in `vite.config.ts`).
- Server bindings for `/api/notify` come from `.dev.vars` — **fill in** `SUPABASE_SERVICE_ROLE_KEY`, `NOTIFY_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (copy from the old Worker's environment: `npx wrangler secret list --name chat` / dashboard). Empty values just make `/api/notify` return 401 locally.
- `npm run preview` = full-stack local run (build + `wrangler dev` serving assets and the worker).
- On Windows, run npm/npx through `cmd /c` (PowerShell execution policy blocks `npx.ps1`).

## Deploy (GitHub → Cloudflare Workers Builds)

The repo is connected in the Cloudflare dashboard (Workers & Pages → `chat` → Settings → Build & deploy), so **every push to the default branch builds and deploys automatically**.

### One-time dashboard changes

Workers & Pages → `chat` → Settings → Build & deploy:

| Setting | Value |
| --- | --- |
| **Build command** | `npm run build` |
| **Deploy command** | `npx wrangler deploy` |
| Root directory | `/` (unchanged) |

Settings → Variables (build environment variables) — the client values are inlined at **build time**, so they must exist during the CI build (they're public-by-design, same values the old client hardcoded):

- `NEXT_PUBLIC_SUPABASE_URL` = `https://bkobrmfarfivxjzcpqbd.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon key from `.env.local`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = the VAPID public key from `.env.local`

(The migration removed Next.js/`opennextjs-cloudflare` from `package.json` entirely — the Vite build has no framework or adapter to configure.)

### Secrets

The Worker's runtime secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTIFY_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) live on the Worker itself in the dashboard — they are **not** repo files and survive every build/deploy, so nothing needs to be redone. Verify after the first deploy: Worker → Settings → Variables and Secrets shows all six, and `/api/notify` answers `401` (not `500`) without a valid `x-notify-secret` header.

If any is missing, set it once (CLI or dashboard → Secrets):
```bash
cmd /c "npx wrangler secret put SUPABASE_URL"
cmd /c "npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY"
cmd /c "npx wrangler secret put NOTIFY_SECRET"
cmd /c "npx wrangler secret put VAPID_PUBLIC_KEY"
cmd /c "npx wrangler secret put VAPID_PRIVATE_KEY"
cmd /c "npx wrangler secret put VAPID_SUBJECT"
```

### Manual deploy fallback

From this folder (skips the GitHub round trip):
```bash
npm run deploy   # = vite build && wrangler deploy
```

The worker is named `chat` — same as the previous one — so deploying replaces it in place: the domain, the `/api/notify` webhook URL and the cron trigger all stay valid. No Supabase webhook changes are needed.

To trial the new worker in parallel instead, change `"name"` in `wrangler.jsonc` to something else, deploy (from GitHub or locally), and point the Supabase database webhook (Database → Webhooks → `notify`) at `https://<new-worker>.workers.dev/api/notify` before cutting over.

### Verify after deploy

`https://chat.nvy.workers.dev` loads the app (HTML refs `/assets/index-*.js`); sending a message to an offline user produces a push; the keep-alive cron fires every 6 h (`npx wrangler tail chat`).

## Behavior notes

- Attachments: photos are compressed (max 1600px, JPEG, 2MB post-compress cap); video/audio are transcoded before upload via WebCodecs (`mediabunny` → 720p H.264 + low-quality AAC, MP4/M4A), with a 100MB input cap and 25MB final cap; generic files upload as-is under a 25MB cap. Everything is E2EE — Storage holds only ciphertext, and recipients decrypt to a local blob URL (inline player for video/audio, file chip with the original filename otherwise).
- `sw.js` is byte-for-byte the original — it still reads the device key from IndexedDB (`circle-e2ee`) and decrypts `messages.notify` previews.
- The pre-paint `<head>` script lives in `index.html` again (as in the vanilla app) — no theme/session flash on load.
- All legacy element ids/classes are kept (`auth-screen`, `chats-screen`, `chat-screen`, `message-list`, `composer`, …) so the verbatim CSS keeps working, including the desktop two-pane layout and keyboard (`--app-height`/`--app-offset-top`) handling.
- `NEXT_PUBLIC_*` values are inlined at **build time** — set them as build environment variables in the dashboard (see Deploy) so git-based builds get them.
