# YouTube captions and audio

YouTube video details include creator-provided and automatic caption tracks when the companion returns them. Automatic tracks are labeled "auto-generated". Each track has its own ID, so manual and automatic captions in the same language remain separate choices.

The player uses native WebVTT for YouTube captions. Crunchyroll ASS tracks still use JASSUB. Language preferences store the language rather than a provider-specific track ID. When choosing an initial track, the player prefers manual captions within the matching language. An explicit Off preference stays off; otherwise the captions-by-default setting applies.

Caption requests pass through core and the YouTube service. The browser never fetches captions from Google directly. The service verifies a signed, six-hour selector containing the video, companion instance and caption label. It fetches a fixed companion endpoint, blocks redirects and validates the WebVTT header. Age-restricted videos use their selected signed-in companion. Keep `CAPTIONS_ENABLED` enabled on the companion, which is its default.

The Audio menu lists available DASH audio tracks by YouTube's display names. Codec alternatives for the same language, label and role appear once. Selection uses dash.js track switching without navigating, seeking or restarting playback. Saved audio language wins when available; otherwise the main/default track is selected. A default track is not necessarily the original recording, so the UI uses YouTube's label rather than inventing an "original" designation.

Unavailable caption metadata doesn't prevent video playback. A failed caption download shows a retry hint. Ambiguous duplicate caption labels are omitted because the companion selects captions by label. Automatic translation into languages YouTube hasn't supplied as tracks is not implemented.

## Verification

```sh
node --test services/youtube/src/*.test.ts apps/web/src/lib/player-tracks.test.ts apps/web/src/lib/quality.test.ts
npm run typecheck --workspaces --if-present
npm run build --workspace @tube/web
node scripts/performance/player-tracks.mjs
node scripts/performance/player-audio.mjs
```

The browser scripts use the dedicated headless Chrome debugger and Vite setup described in `frontend-performance.md`. The audio test also needs FFmpeg. It generates local DASH media with two audio tracks and checks switching while paused and playing, position continuity, unchanged navigation, and native VTT cues. These fixtures do not verify live YouTube responses or authenticated playback.
