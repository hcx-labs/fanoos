/*
 * The merged subscriptions feed. For each linked account in the feed: sync its
 * subscription list (Data API, refreshed every few hours), read every channel's
 * public RSS feed (no quota, cached), merge and de-duplicate across accounts,
 * drop Shorts, then enrich with durations/views (Data API, batched) and
 * community titles (DeArrow).
 */
import { XMLParser } from "fast-xml-parser";
import type { Channel, Video } from "@tube/shared";
import { mapLimit, SharedCache } from "./cache.ts";
import { db } from "./db.ts";
import { fetchSubscriptions, fetchVideoStats, RelinkRequired, type VideoStats } from "./google.ts";
import { proxyImage } from "./media.ts";
import { communityTitle } from "./extras.ts";
import { channelPage } from "./innertube.ts";
import { thumb } from "./parse.ts";

const SYNC_EVERY = 6 * 36e5;
const NEW_WINDOW = 48 * 36e5;

/** Refresh an account's subscription list from Google when it's stale. */
export async function syncSubscriptions(ref: string, force = false) {
  const row = db.prepare("SELECT synced_at FROM accounts WHERE ref = ?").get(ref) as { synced_at: number } | undefined;
  if (!row || (!force && Date.now() - row.synced_at < SYNC_EVERY)) return;
  const subs = await fetchSubscriptions(ref);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM subscriptions WHERE account_ref = ?").run(ref);
    const insert = db.prepare("INSERT OR IGNORE INTO subscriptions (account_ref, channel_id, title, avatar) VALUES (?, ?, ?, ?)");
    for (const s of subs) insert.run(ref, s.channelId, s.title, s.avatar ?? null);
    db.prepare("UPDATE accounts SET synced_at = ? WHERE ref = ?").run(Date.now(), ref);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The usable accounts among the refs core asked for. */
function usable(refs: string[]): string[] {
  if (!refs.length) return [];
  const rows = db
    .prepare(`SELECT ref FROM accounts WHERE needs_relink = 0 AND ref IN (${refs.map(() => "?").join(",")})`)
    .all(...refs) as { ref: string }[];
  const ok = new Set(rows.map((r) => r.ref));
  return refs.filter((r) => ok.has(r));
}

/** Sync every account; one failing account doesn't block the others. */
async function syncAll(refs: string[], force = false) {
  await Promise.all(
    refs.map((ref) =>
      syncSubscriptions(ref, force).catch((error) => {
        if (!(error instanceof RelinkRequired)) console.warn(`subscription sync failed for ${ref}:`, (error as Error).message);
      }),
    ),
  );
}

/** Merged channel list across accounts, with the account refs each came through. */
function mergedChannels(refs: string[]): (Channel & { via: string[] })[] {
  if (!refs.length) return [];
  const rows = db
    .prepare(`SELECT channel_id, title, avatar, account_ref FROM subscriptions WHERE account_ref IN (${refs.map(() => "?").join(",")})`)
    .all(...refs) as { channel_id: string; title: string; avatar: string | null; account_ref: string }[];
  const map = new Map<string, Channel & { via: string[] }>();
  for (const r of rows) {
    const existing = map.get(r.channel_id);
    if (existing) existing.via.push(r.account_ref);
    else
      map.set(r.channel_id, {
        id: r.channel_id,
        provider: "youtube",
        name: r.title,
        avatar: proxyImage(r.avatar ?? undefined),
        unseen: 0,
        via: [r.account_ref],
      });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// RSS: the last 15 uploads per channel, public and quota-free.
type RssEntry = { id: string; title: string; published: string; description: string; views: number; short: boolean };
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const rssCache = new SharedCache<RssEntry[]>("rss");

/** The channel's public RSS feed, or null when YouTube doesn't serve it (it often 404s or 500s). */
async function fromRss(channelId: string): Promise<RssEntry[] | null> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const doc = xml.parse(await res.text());
  const entries = [doc.feed?.entry ?? []].flat();
  return entries.map((e: Record<string, any>) => ({
    id: String(e["yt:videoId"]),
    title: String(e.title ?? ""),
    published: String(e.published),
    description: String(e["media:group"]?.["media:description"] ?? ""),
    views: Number(e["media:group"]?.["media:community"]?.["media:statistics"]?.["@views"] ?? 0),
    short: String(e.link?.["@href"] ?? "").includes("/shorts/"),
  }));
}

/** Fallback: the channel's videos tab through YouTube.js (dates are approximate, Shorts aren't listed there). */
async function fromChannelTab(channelId: string): Promise<RssEntry[]> {
  const { videos } = await channelPage(channelId);
  return videos.slice(0, 15).map((v) => ({
    id: v.id,
    title: v.title,
    published: v.published,
    description: v.description,
    views: v.views,
    short: false,
  }));
}

/**
 * Latest uploads for a channel: RSS first, the videos tab if RSS fails. Only
 * successful results are cached; if both fail this throws, so the next load retries.
 */
const rss = (channelId: string) => rssCache.get(channelId, async () => (await fromRss(channelId)) ?? fromChannelTab(channelId));

// Durations, views, live state and categories, fetched in batches of 50 for whatever isn't cached.
const statsCache = new SharedCache<VideoStats>("stats");

async function enrich(accountId: string, ids: string[]) {
  const { values: known, stale } = await statsCache.getMany(ids);
  const fetchAndStore = async (list: string[]) => {
    const fetched = await fetchVideoStats(accountId, list);
    await statsCache.setMany([...fetched]);
    return fetched;
  };
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) {
    try {
      for (const [id, stats] of await fetchAndStore(missing)) known.set(id, stats);
    } catch (error) {
      console.warn("video stats failed:", (error as Error).constructor.name, (error as Error).message);
    }
  }
  // Stale stats are good enough to show now; refresh them without waiting.
  if (stale.length) fetchAndStore(stale).catch((error: Error) => console.warn("video stats refresh failed:", error.message));
  return (id: string) => known.get(id);
}

/** Wait for community titles, but never longer than the budget. */
async function titles(ids: string[], budgetMs = 2500) {
  const found = new Map<string, string>();
  await Promise.race([
    mapLimit(ids, 8, async (id) => {
      const t = await communityTitle(id).catch(() => undefined);
      if (t) found.set(id, t);
    }),
    new Promise((resolve) => setTimeout(resolve, budgetMs)),
  ]);
  return found;
}

export async function subscriptions(refs: string[], refresh = false): Promise<(Channel & { via: string[] })[]> {
  const accounts = usable(refs);
  await syncAll(accounts, refresh);
  const channels = mergedChannels(accounts);
  // Count recent uploads from whatever RSS is already cached or quick to fetch.
  await mapLimit(channels, 8, async (c) => {
    const entries = await rss(c.id).catch(() => []);
    c.unseen = entries.filter((e) => !e.short && Date.now() - Date.parse(e.published) < NEW_WINDOW).length;
  });
  return channels;
}

export async function feed(refs: string[], limit = 120): Promise<Video[]> {
  const accounts = usable(refs);
  if (!accounts.length) return [];
  await syncAll(accounts);
  const channels = mergedChannels(accounts);
  const perChannel = await mapLimit(channels, 8, async (c) => ({ channel: c, entries: await rss(c.id).catch(() => [] as RssEntry[]) }));

  const items = perChannel
    .flatMap(({ channel, entries }) => entries.filter((e) => !e.short).map((e) => ({ channel, e })))
    .sort((a, b) => b.e.published.localeCompare(a.e.published))
    .slice(0, limit);

  const ids = items.map(({ e }) => e.id);
  const [statsOf, community] = await Promise.all([enrich(accounts[0]!, ids), titles(ids.slice(0, 60))]);

  return items
    .map(({ channel, e }): Video => {
      const stats = statsOf(e.id);
      return {
        id: e.id,
        provider: "youtube",
        title: e.title,
        altTitle: community.get(e.id),
        channelId: channel.id,
        channelName: channel.name,
        channelAvatar: channel.avatar,
        duration: stats?.duration ?? 0,
        views: stats?.views ?? e.views,
        published: e.published,
        description: e.description,
        thumbnail: proxyImage(thumb(e.id)),
        live: stats?.live,
        upcoming: stats?.upcoming,
        category: stats?.category,
        via: channel.via,
      };
    })
    // Shorts that slipped through the RSS link check (vertical, ≤ 60 s).
    .filter((v) => !(v.duration > 0 && v.duration <= 60));
}

/** Which of these accounts subscribe to a channel. */
export function followers(refs: string[], channelId: string): string[] {
  if (!refs.length) return [];
  return (
    db
      .prepare(`SELECT account_ref FROM subscriptions WHERE channel_id = ? AND account_ref IN (${refs.map(() => "?").join(",")})`)
      .all(channelId, ...refs) as { account_ref: string }[]
  ).map((r) => r.account_ref);
}

/** Channels any of these accounts follow (filters related videos). */
export function followedSet(refs: string[]): Set<string> {
  if (!refs.length) return new Set();
  return new Set(
    (
      db.prepare(`SELECT DISTINCT channel_id FROM subscriptions WHERE account_ref IN (${refs.map(() => "?").join(",")})`).all(...refs) as {
        channel_id: string;
      }[]
    ).map((r) => r.channel_id),
  );
}
