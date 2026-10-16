# Fanoos

*Fanoos* (فانوس) is Persian/Urdu for "lantern". *Fanoos-e-khayal*, the "lantern of imagination", was the revolving magic lantern that cast moving pictures before cinema.

A privacy-first video client. This is the frontend only, running on demo data. The name is set in `src/lib/brand.ts`.

## Model

- **Fanoos account (`Profile`):** your own sign-in. It owns everything below and syncs it across devices. Watch history never leaves the device.
- **Backend:** a server that talks to one service for you. A backend has a provider kind (only `youtube` today), a label and a URL.
- **Linked account:** a service account signed in through a backend. A profile can hold many, across many backends: YouTube acc1 and acc2 on the home server, acc3 on another instance, and so on.
- **The merged feed:** subscriptions from every linked account marked "in feed" are merged and deduplicated. Each item records which accounts it came through (`via`).
- **Writes:** likes, comments and subscribing use the **default** account. The subscribe control and the comment box let you pick a different one.

```sh
npm install
cp apps/server/.env.example apps/server/.env   # then add your Google OAuth client (below)
npm run dev                                     # web :5180, API :8787, companion :8282, Redis :6379
```

Needs Node 24+, [Deno](https://deno.com) (`brew install deno`) for the streaming companion, and Redis (`brew install redis`) for the response cache. After cloning, run `git submodule update --init`.

### Single sign-on (OIDC)

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` (optionally `OIDC_SCOPES` and `OIDC_NAME`, the button label) in `apps/server/.env`, and register `${PUBLIC_URL}/api/auth/oidc/callback` as a redirect URI with your provider (Authentik, Keycloak, Authelia, and so on). When OIDC is on:

- The sign-in page shows only "Continue with <name>". The server refuses password and passkey sign-in, sign-up and passkey registration, and treats existing password or passkey sessions as signed out.
- Accounts are created automatically on first sign-in, with no approval step.
- If the provider marks the email as verified and a Fanoos account already uses that email, the two are linked (keeping its data and ownership). An unverified email that matches an existing account is refused.
- The flow is the authorization code flow with PKCE, `state` (bound to the browser) and `nonce`. ID tokens are checked against the provider's JWKS, issuer, audience and expiry.

Signing out ends the Fanoos session only, not the provider's.

### Caching (Redis)

`npm run redis` starts a local, memory-only Redis (256 MB, least-recently-used eviction, nothing written to disk). The API caches YouTube responses there for `CACHE_TTL_SECONDS` (default 600): video and channel pages, search, playlists, channel uploads, video stats and categories, SponsorBlock, Return YouTube Dislike, DeArrow, playability and stream manifests, and each account's ratings. The cache survives API restarts. Failures are never cached. Without `REDIS_URL`, a bounded in-memory cache is used instead.

Channel uploads come from YouTube's RSS feeds, which often return 404 or 500. When they do, the API falls back to the channel's videos tab through YouTube.js.

### Streaming (Invidious companion)

YouTube only streams the first chunk of a video unless the request carries a valid anti-bot (PO) token. [Invidious companion](https://github.com/iv-org/invidious-companion) (pinned submodule in `vendor/`) generates those tokens and streams media. It listens on 127.0.0.1 only; the API rewrites its stream URLs to the signed `/api/media` proxy. `COMPANION_SECRET` in `apps/server/.env` must be exactly 16 characters.

Age-restricted videos need a signed-in session. `npm run companion:signed-in` starts a second instance (port 8283, `COMPANION_SIGNED_IN_URL`). On first start, its log shows a code to enter at google.com/device. The API only uses it for videos YouTube age-restricts, so ordinary viewing stays signed out. Use a secondary Google account: that account's playback of those videos is visible to Google, and unofficial clients carry some risk of account restrictions.

Open **http://localhost:5180** (not 127.0.0.1; passkeys need a hostname) and create an account. Search, playback, comments and channels work right away; the subscriptions feed needs a linked YouTube account.

### Linking real YouTube accounts (Google OAuth)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **Google Auth Platform → Branding**: set an app name and support email. **Audience**: External, and add every Google account you'll link as a **test user**. **Data access**: add the scope `https://www.googleapis.com/auth/youtube.readonly`.
4. **Clients → Create client → Web application**. Authorized JavaScript origin `http://localhost:5180`; authorized redirect URI `http://localhost:5180/api/links/google/callback`.
5. Put the client ID and secret in `apps/server/.env`, then restart `npm run dev`.
6. In the app: **Settings → Linked accounts → Link an account → Continue with Google**. Repeat for each account.

While the Google app is in "Testing", only listed test users can link, and Google expires their refresh tokens after 7 days; the app then shows **Link again**. Publishing the app (and Google's verification for the YouTube scope) removes both limits.

## Layout

npm workspaces:

- `apps/web`: the React app (Vite, Tailwind v4, shadcn kit components in `src/components/ui/`, copied from `../shadcn-ui-kit-dashboard`).
- `apps/server`: the API (Hono on Node 24+, runs TypeScript directly; SQLite via `node:sqlite`).
- `packages/shared`: types shared by both. Types only, no runtime code.

## How the server works

- **Fanoos accounts:** passkeys (WebAuthn) or passwords (scrypt). Sessions use an HttpOnly, SameSite=Lax cookie. Every write is checked against the app's Origin.
- **Linked accounts:** Google OAuth with PKCE, scope `youtube.readonly`. Refresh tokens are encrypted with AES-256-GCM. Unlinking also revokes access at Google.
- **Feed:** each linked account's subscription list comes from the Data API, refreshed every 6 hours. New videos come from each channel's public RSS feed (no quota). Results are merged across accounts, Shorts are dropped, and the feed is enriched with durations and views (one batched Data API call per 50 videos) and DeArrow titles.
- **Video, comments, channels, search:** YouTube.js, signed out.
- **Playback:** DASH manifests and media from Invidious companion, played with dash.js. Thumbnails are 1280×720.
- **Privacy:** every thumbnail, avatar and media segment goes through `/api/img` and `/api/media`, which only fetch URLs the server signed itself. The browser never contacts Google. SponsorBlock and DeArrow are queried by a hash prefix.
- **Up next:** this channel's uploads, then related videos only from channels you follow. No recommendations.

## Not yet

- Writes: subscribing, liking, commenting and editing playlists. These need the `youtube.force-ssl` scope.
- Linking through other servers (remote backends). Live stream playback. A playlist page. Captions (the companion serves them; the player doesn't show them yet).
