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

Downloads stays in the desktop sidebar online and offline, with a progress badge while
transfers run (and dock/taskbar progress). On a YouTube video or a Plex movie/episode,
choose Download:

- **YouTube** offers one choice per resolution with its size; the codec is picked for the
  device (AV1/VP9 when hardware-decoded, otherwise H.264). Audio language appears when
  there is more than one. The last quality and caption languages are remembered.
- **Plex** offers each audio track at Original quality (the video copied untouched) or
  1080p/720p/480p/360p. Your Plex server converts while the desktop app saves its DASH
  segments, and audio is converted to AAC stereo so tracks like AC3 play. Finished segments are
  kept, so an interrupted download continues where it stopped. Re-encoding the video is limited
  by the server's CPU/GPU, and copying the video is usually limited by the network. Desktop
  builds without segment support save the original file instead, which plays its default audio.
  Text subtitles are saved (ASS keeps its styling, and Forced tracks are a separate choice). Image
  subtitles such as PGS aren't offered. Items
  split into several files are not downloadable. A show page has **Download season**: pick
  episodes (already saved ones are marked) and subtitle languages, see the total size
  against free space, and they're queued in episode order. Movie pages have Download too.

The dialog shows free disk space and refuses a download that would not fit. Afterwards the
watch page button shows its state (Downloaded / progress / Paused / Failed) with play, pause,
resume, cancel and remove. The queue runs oldest first, shows speed and time left, and has
Pause all / Resume all. A dropped connection or server error retries automatically (after
5 s, 30 s, 2, 5 and 10 min). Completion shows a toast, or a system notification when the window is
unfocused. Downloads are grouped by channel or show (episodes in season order); Plex movies
share one Movies group. Offline, a saved episode plays on to the next saved one. Offline
search matches titles, channels/shows, seasons and descriptions. Online playback of a
download keeps the normal online navigation.

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
beats are not currently replayed to the server. Offline positions are also reported to
services that track progress themselves (Plex, Crunchyroll) on reconnect.

A transfer interrupted by quitting, signing out or switching profile continues on its own
once that profile connects again, resolving fresh stream URLs and continuing matching
files with byte ranges. A changed track is
restarted; a source ignoring Range is handled without appending duplicate data. Completed
tracks are reused while retrying captions. Live/upcoming videos and DRM streams are
excluded. Playlists and whole shows can't be downloaded in one go; seasons can.

Downloads and saved playback state are scoped to the server origin and Fanoos profile.
Sign-out offers to remove local downloads; keeping them locks access until that profile
signs in again. The renderer has no filesystem or arbitrary download-URL bridge.

## Runtime and releases

The runtime is pinned to [castLabs Electron for Content Security](https://github.com/castlabs/electron-releases).
Widevine initializes in the background so offline/YouTube use doesn't depend on CDM
installation. Production Windows/macOS Crunchyroll **streaming** requires the appropriate
[VMP signing](https://github.com/castlabs/electron-releases/wiki/EVS), separate from OS
signing/notarization. Crunchyroll offline downloads are not implemented. The desktop download
queue supports YouTube and Plex (backends advertising the `downloads` feature); this app does not implement persistent DRM
licenses for offline Crunchyroll playback. Saving encrypted segments alone does not
provide an offline playback license.

The macOS package includes the Fanoos lantern icon. Regenerate its assets with
`npm run build:icon --workspace @fanoos/desktop` after changing the brand artwork.
Before distributing publicly, configure OS signing/notarization and release updates.
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

### Production Widevine / EVS

The runtime installs and updates Google's Widevine CDM with castLabs Components.
YouTube and offline playback remain available while installation runs. Protected
playback waits for CDM readiness before creating an EME session or loading DASH.

On macOS and Windows, the stock ECS certificate is development-only. Crunchyroll
production playback needs an EVS streaming signature as well as a valid account.
Set up the free EVS account locally (never put credentials in source control):

```sh
python3 -m venv apps/desktop/.venv-evs
apps/desktop/.venv-evs/bin/python -m pip install castlabs-evs
apps/desktop/.venv-evs/bin/python -m castlabs_evs.account signup
# For an existing account, use `reauth` instead of `signup`.
npm run pack:drm --workspace @fanoos/desktop -- --mac --arm64
```

On Windows use `.venv-evs/Scripts/python.exe`. `EVS_PYTHON` can point to another
Python installation containing the EVS client. The client stores credentials in
its own configuration, outside the app. Production builds run non-interactively
and fail if signing or verification fails; authenticate before building.

`pack:drm` and `dist` automatically VMP-sign and verify packages. macOS signs VMP
in afterPack, before Apple signing; Windows uses afterSign, after Authenticode.
Linux needs no VMP signature. The normal `pack` command remains available for
local development and explicitly reports that production DRM signing is skipped.
This packaging flow requests streaming signatures; it does not implement offline
DRM playback. YouTube file downloads do not require persistent DRM licensing.

After signing, validate a Crunchyroll episode with the local connected account:
CDM availability alone does not prove production licensing or decryption succeeds.
