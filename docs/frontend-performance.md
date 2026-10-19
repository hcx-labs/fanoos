# Frontend performance review

## What changed

- `components/shell/layout.tsx`: removed the entrance animation from the entire route container. Animating a long page's opacity and transform creates work across a much larger area than the viewport. Route keys, scroll resets and same-episode navigation remain intact.
- `styles.css` and `components/video-card.tsx`: removed the sticky header's backdrop blur and hundreds of thumbnail badge backdrop filters. The scrolled header and mobile navigation now have solid backgrounds. Thumbnail badges keep their dark backgrounds.
- `components/hero.tsx`: an intersection observer and document visibility gate stop the rotation timer and progress animation when the hero is offscreen or the tab is hidden. Returning to it starts a fresh seven-second interval.
- `pages/watch.tsx`: playback ticks no longer update state in `WatchPage`. A stable callback sends time to the chapter panel, which updates state only when the active chapter changes. Metadata, comments and the recommendation-free next-video list no longer inherit every playback tick.
- `components/video-card.tsx`: memoized cards and rows. Titles subscribe only to DeArrow, and thumbnails subscribe only to segment settings rather than every player preference. Existing per-video progress and Watch later subscriptions still update independently. Thumbnail decoding is asynchronous.
- `lib/session.ts`: hoisted the external-store subscription and snapshot functions so renders do not unsubscribe and resubscribe.
- `components/player/player.tsx`: stabilized the empty subtitle list so playback ticks do not reinstall the keyboard listener. Stream cleanup now removes pending metadata listeners, ignores codec-selection work that completes after disposal, and releases progressive media resources.
- `lib/store.ts`: updates returning the same state no longer notify subscribers or schedule a save. Setting an unchanged preference is also a no-op.
- `app.tsx`: lazy-load the watch route, keeping DASH and subtitle code out of the initial JavaScript download.

## Headless Chrome measurements

These are local development-build measurements, not production telemetry. Chrome used a dedicated profile, a 1440 by 900 viewport and browser-local API fixtures. The fixture contains 600 videos and 30 channels. Clearing the default date filter displays 595 cards, excluding the five hero entries, with 13,617 DOM elements. A six-second animation-frame-driven scroll advances to 18,000 pixels.

| Measure | Before | After |
| --- | ---: | ---: |
| Main-thread task time during scroll | 2.101 s | 0.395 to 0.462 s across five runs |
| Long tasks over 50 ms | 6 | 0 |
| Largest frame interval | 216.7 ms | 16.8 ms |
| 95th-percentile frame interval | 16.8 ms | 16.7 ms |
| Style recalculations | 279 | 18 in the first after run |

The initial before/after runs included identical development React instrumentation. The checked-in test omits that instrumentation. Its subsequent run measured 0.377 seconds of main-thread task time with no long tasks. Do not interpret animation-frame intervals as hardware presentation or GPU utilization measurements.

The production build's entry JavaScript fell from 1,637.64 kB to 724.94 kB, or from 485.40 kB to 220.23 kB gzipped. The deferred watch chunk is 913.96 kB, 267.29 kB gzipped. Vite still warns about large chunks.

## Regression checks

`node scripts/performance/run.mjs` exercises the current app through Chrome's DevTools Protocol without adding dependencies:

- Large-feed scroll with long-task and main-thread metrics.
- Eight seconds of observation after scrolling the hero away, with no hero DOM mutations allowed.
- Navigation into a video with 40 next-video rows.
- Forty synthetic playback time events. The watch page's React hook-state identity must remain unchanged, no new window keyboard subscriptions may occur, and the chapter panel must select the chapter containing 120 seconds.
- Navigation through Library, Following, Calendar, Analytics, Settings and Home, checking headings and removal of the video element.
- Search through the command palette, followed by channel navigation.
- A 390-pixel mobile viewport with an overflow check and screenshot.

The playback-state assertion deliberately inspects development React internals. Run it against Vite development mode. It may need adjustment after a React upgrade.

### Run locally

Start the frontend in one terminal:

```sh
npm run dev --workspace @tube/web -- --host 127.0.0.1 --port 5190
```

Start a separate headless Chrome instance in another terminal. On macOS:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9333 \
  --user-data-dir=/tmp/tube-performance-chrome \
  --no-first-run --no-default-browser-check about:blank
```

On Linux, use the installed Chrome or Chromium executable with the same flags. Then:

```sh
node scripts/performance/run.mjs
npm run build --workspace @tube/web
```

Optional environment variables are `PERF_URL`, `CHROME_DEBUG_URL` and `PERF_SCREENSHOT`. Screenshots default to `/tmp/tube-performance.png` and `/tmp/tube-performance-mobile.png`. Use a dedicated debug browser. The script navigates its first page and installs a browser-local fetch replacement before app startup. API writes never reach the server during this test. Stop the test Chrome and Vite processes when finished.

## Remaining risks and limits

The fresh browser reached sign-in, so authenticated service data was not available. Fixtures validate frontend behavior without account changes, but they cannot validate real image download costs, DASH playback, DRM, styled subtitles, remote API latency or GPU video decoding. Ambient mode has been restored to its original implementation at the user's request: 250 ms sampling, two canvases, the original CSS crossfade and layout read, and the original pause/visibility behavior. The experimental offscreen gate and Web Animations crossfade are no longer present. Headless Chrome cannot establish that CPU or GPU usage will never spike on a physical device.

Large lists still mount every card. The fixture's 13,617 elements are a remaining memory and initial-render cost. If feeds routinely exceed this size, add pagination or windowing with explicit tests for sticky date headings, browser find, keyboard focus and scroll restoration. Do not add guessed card heights merely to improve a benchmark.

`useData` drops stale results but does not cancel requests or share them between consumers. Home and the persistent channel rail independently load following data. Request deduplication and abort support would reduce navigation/network work, but need cache invalidation rules for account and subscription changes.

The player still updates its own React state on `timeupdate`, as its seek bar and segment behavior require. The change bounds those updates rather than removing them. Real-stream profiling should check that hidden controls and subtitle rendering do not dominate playback CPU. The default ambient effect still uses a large blurred layer while visible; users can disable it in settings.

The independent static review also identified functional issues outside these performance changes: the autoplay countdown does not consume zero, asynchronous pasted-link resolution can override later navigation, and same-video timestamp query changes are not applied after player initialization. These remain open and need dedicated behavior tests. Real DASH stream replacement cleanup has been inspected but not exercised against a signed-in stream.

Existing unrelated working-tree changes were preserved. This review does not certify every route or media backend against every device.
