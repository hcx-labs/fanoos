# Fanoos desktop

The desktop app loads your Fanoos server when online and includes a bundled offline
shell with the same top bar, sidebar, themes, and player. Connect to an HTTPS server
origin; HTTP is accepted on localhost for development. The server runs separately.

From the repository root:

```sh
npm install
npm run dev --workspace @fanoos/desktop
npm run pack --workspace @fanoos/desktop -- --mac --arm64
npm run dist --workspace @fanoos/desktop
```

Development and packaging build the offline web entry automatically. Web UI changes
appear immediately from your server; native bridge or bundled offline changes require
rebuilding/restarting the desktop app. No server is bundled.

## Downloads

Downloads stays in the desktop sidebar online and offline. On a YouTube watch page,
choose Download, a supported video quality, one audio track, and optional captions.
The queue supports pause, resume/retry, cancellation, and deletion. Downloads use
available disk space and stop before exhausting it. Downloads are grouped by
channel/show; offline search matches titles, channels/shows, and descriptions. Online playback of a download keeps the normal online navigation.

Media is saved under `offline-media` in Electron's user-data directory. An atomically
updated `downloads.json` holds the queue and metadata: original/community titles,
channel information, publication/download dates, description, chapters, SponsorBlock
segments, captions, and selected tracks. Thumbnails and channel avatars are saved when
available. The same DASH player reads local video/audio files without re-encoding;
SponsorBlock, chapters, captions, media keys, and playback settings work offline.

On cold launch, an unavailable server opens Downloads automatically. File → Downloads
also opens the offline shell. Other destinations show Offline; search stays local.
Reconnect returns to the server and merges offline playback positions and watch history
without overwriting unchanged positions from other devices. Offline watch-time Analytics
beats are not currently replayed to the server.

An interrupted transfer is paused on restart. Resume in the online app to resolve fresh
stream URLs and continue matching track files with byte ranges. A changed track is
restarted; a source ignoring Range is handled without appending duplicate data. Completed
tracks are reused while retrying captions. Live/upcoming videos and DRM streams are
excluded. This version downloads individual YouTube videos, not entire playlists.

Downloads and saved playback state are scoped to the server origin and Fanoos profile.
Sign-out offers to remove local downloads; keeping them locks access until that profile
signs in again. The renderer has no filesystem or arbitrary download-URL bridge.

## Runtime and releases

The runtime is pinned to [castLabs Electron for Content Security](https://github.com/castlabs/electron-releases).
Widevine initializes in the background so offline/YouTube use doesn't depend on CDM
installation. Production Windows/macOS Crunchyroll **streaming** requires the appropriate
[VMP signing](https://github.com/castlabs/electron-releases/wiki/EVS), separate from OS
signing/notarization. Crunchyroll offline downloads are disabled: current browser CDMs
no longer provide persistent licenses; saving encrypted segments alone is insufficient.

Before distributing, configure icons, OS signing/notarization, and release updates.
Verify password/OIDC login, passkeys (especially macOS Touch ID), and signed Crunchyroll
streaming on each target OS. Popup-based authentication may need provider-specific work.

## Validation

```sh
npm run typecheck
npm run test --workspace @fanoos/desktop
npm run test:progress --workspace @tube/web
npm run build --workspace @tube/web
npm run build:offline --workspace @tube/web
```

For the macOS end-to-end check, build the app and keep the local stack running on :5180:

```sh
npm run test:e2e --workspace @fanoos/desktop
```

The check creates a disposable Fanoos profile and isolated desktop data directory,
downloads a short YouTube video through a test proxy (:5195), and disconnects only that
proxy. It verifies cold offline launch, the shared shell, local search, playback/seeking,
captions, metadata, minimum window width, and progress sync after reconnect. Screenshots
and logs are left in its reported temporary directory. Your normal desktop session and
local stack are not stopped. Ports :5195 and :9334 must be free. Override
`FANOOS_E2E_SERVER` or `FANOOS_E2E_BINARY` to test another local server/build.

`FANOOS_DESKTOP_DATA_DIR` isolates desktop state for development/testing; normal launches
use Electron's standard user-data location.
