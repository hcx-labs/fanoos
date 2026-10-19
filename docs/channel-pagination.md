# Channel video pagination and playback quality

YouTube channel pages now have a **Load more videos** button. Each click fetches one upstream batch and appends new video IDs. Existing cards stay mounted. Failed requests leave the list intact and can be retried; an expired cursor offers **Reload videos**. Leaving the page aborts pending requests and ignores late responses.

Loading is explicit rather than automatic. Search submits to YouTube's channel-wide search, and Popular requests YouTube's Popular uploads view. Neither operates on the already-loaded list. Search results use YouTube's relevance order; selecting Latest or Popular exits search. Each view has its own pagination, and changing views cancels pending requests. During switches the header and search field remain mounted, with skeleton cards but no loading-text label.

## Provider contract

`ChannelPage.next` is optional. Request channel search with `q`, sorting with `sort=new|popular`, and the next batch with `next=<cursor>`, retaining the same query and sort. Core forwards the cursor and preserves normal backend/linked-account mapping. Crunchyroll season loading is unchanged.

YouTube.js continuation objects contain live methods and cannot go into the JSON Redis cache. Channel browsing therefore uses a separate one-minute process-local first-page cache and bounded 30-minute cursor storage. Feed and watch-page channel lookups continue using the existing shared cache, without cursors.

Cursors are bound to the channel and search/sort view, and opaque. Concurrent requests and retries share the same result. An upstream failure clears only the failed result so it can be retried. Expiry, eviction or service restart returns HTTP 410 with `cursor_expired`; core relays that code and the frontend offers a restart. A deployment with multiple YouTube workers needs worker affinity for browsing, or a future serializable continuation implementation. No live cursor objects are written to Redis.

## Quality preference

The saved resolution remains a preference. Both the player selection and menu resolve it to the highest available height at or below that preference, falling back to the lowest height if every available option is higher. A saved 1440p preference therefore displays and selects 1080p for a video capped at 1080p, and uses 1440p again when a later video supports it. Switching streams clears stale heights and the previously rendered resolution.

## Checks

```sh
node --test services/youtube/src/channel-cursors.test.ts services/youtube/src/channel-list.test.ts apps/web/src/lib/quality.test.ts
node scripts/performance/channel-pagination.mjs
node scripts/performance/channel-search.mjs
npm run typecheck --workspaces --if-present
npm run build --workspace @tube/web
```

The Chrome scripts use the dedicated headless Chrome and Vite setup in `frontend-performance.md`. They test append/deduplication, transient errors, expired cursors, reload, double clicks, end-of-list, upstream query/sort parameters and stale responses after navigation or query changes. Quality-menu checks inject manifest heights into a development React component. They verify the label and selected option, not real DASH decoding. The browser uses local API fixtures; live YouTube continuation behavior still depends on YouTube's availability and current response format.
