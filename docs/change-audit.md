# Audit of frontend and channel browsing changes

This audit covers the changes made in this session. It does not certify the unrelated account, backend, calendar or deployment edits already present in the working tree.

## Findings fixed

1. **Cursor misses could evict valid cursors.** A full cache used its allocating lookup to check unknown tokens. Added a non-allocating `TtlCache.peek` and a regression test that keeps a valid cursor usable after an unknown-token request.
2. **Legacy YouTube Popular filters could fail.** youtubei.js 18 exposes legacy chip labels through `filters` but its channel `applyFilter` implementation requires the newer chip bar. Legacy chips now call their own endpoint and produce a pageable `FilteredChannelList`. The test uses actual library parser nodes and follows the continuation into a second page.
3. **Season failures could silently retain old results.** The show page now reports the error, says that the previously loaded season is still shown, and offers retry. Retained channel data is also scoped to the source/account and channel identity. Normal route keys already remounted channel pages, but explicit scoping also protects source changes without navigation.
4. **Failed artwork was cached indefinitely.** Failed palette extractions now leave the cache so a later visit can retry. The browser test fails artwork requests, restores connectivity, revisits, and checks the new palette.
5. **Audio switches reset the chapter panel.** The chapter panel now shares the player's episode identity and preserves its selected tab. It remembers time in a ref and recalculates chapter selection when chapter data changes while paused, without lifting playback ticks back into page state.
6. **A failed lazy player download could crash the app.** A route-level boundary now offers reload and navigation back to the feed. The browser test blocks the watch module request, verifies recovery UI and working navigation, then reloads successfully.

## Verification

All of these passed after the fixes:

```sh
node --test services/youtube/src/channel-cursors.test.ts services/youtube/src/channel-list.test.ts apps/web/src/lib/quality.test.ts
npm run typecheck --workspaces --if-present
npm run build --workspace @tube/web
node scripts/performance/run.mjs
node scripts/performance/channel-pagination.mjs
node scripts/performance/channel-search.mjs
node scripts/performance/appearance.mjs
node scripts/performance/audit.mjs
```

The 10 unit tests cover cursor binding, expiry, eviction, retries, concurrency, quality fallback, upstream search/sort dispatch and legacy parser/continuation behavior. Chrome checks include pagination, stale requests, query and sort changes, mobile navigation at 320/375/390/430 pixels, privacy popover sizing, glow source priority and transitions, season errors, artwork recovery, chunk failure recovery and paused language switching.

The original ambient effect and canvas transition markup match `HEAD` exactly. No ambient optimizations were reintroduced.

The repeated 595-card scroll test recorded no long tasks, a 16.8 ms maximum frame interval and 0.347 seconds of main-thread task time over six seconds. These are synthetic development-build measurements, not hardware GPU measurements.

## Limits and remaining issues

- Chrome tests use browser-local fixtures. They do not prove authenticated YouTube/Crunchyroll availability, real DASH/DRM playback, subtitle rendering, codec switching or behavior on a physical phone. The quality UI test injects manifest heights rather than decoding a real stream. The legacy parser test uses synthetic response data with the installed library.
- YouTube cursors remain process-local. Multiple service workers need affinity; restart/eviction produces a recoverable cursor-expired error. See `channel-pagination.md`.
- Large lists still grow the DOM as more pages are loaded. Vite still reports large JavaScript chunks. Neither warning is hidden by this audit.
- The earlier review identified separate pre-existing functional issues that remain outside these changes: the autoplay countdown does not consume zero, late pasted-link resolution can override newer navigation, and same-video timestamp query changes are not applied after player initialization. These are not being claimed as fixed.
