/*
 * The merged subscriptions feed. For each linked account in the feed: sync its
 * subscription list (Data API, refreshed every few hours), read every channel's
 * public RSS feed (no quota, cached), merge and de-duplicate across accounts,
 * drop Shorts, then enrich with durations/views (Data API, batched) and
 * community titles (DeArrow).
 */
import { XMLParser } from "fast-xml-parser";
import type { Channel, Video } from "@tube/shared";
import { mapLimit, SharedCache } from "../cache.ts";
import { db } from "../db.ts";
import { fetchSubscriptions, fetchVideoStats, RelinkRequired, type VideoStats } from "../google.ts";
import { proxyImage } from "../media.ts";
import { communityTitle } from "./extras.ts";
import { channelPage } from "./innertube.ts";
import { thumb } from "./parse.ts";

const SYNC_EVERY = 6 * 36e5;
const NEW_WINDOW = 48 * 36e5;

type FeedAccount = { id: string; synced_at: number };

/** Refresh an account's subscription list from Google when it's stale. */
export async function syncSubscriptions(accountId: string, force = false) {
  const row = db.prepare("SELECT synced_at FROM accounts WHERE id = ?").get(accountId) as { synced_at: number } | undefined;
  if (!row || (!force && Date.now() - row.synced_at < SYNC_EVERY)) return;
  const subs = await fetchSubscriptions(accountId);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM subscriptions WHERE account_id = ?").run(accountId);
    const insert = db.prepare("INSERT OR IGNORE INTO subscriptions (account_id, channel_id, title, avatar) VALUES (?, ?, ?, ?)");
    for (const s of subs) insert.run(accountId, s.channelId, s.title, s.avatar ?? null);
    db.prepare("UPDATE accounts SET synced_at = ? WHERE id = ?").run(Date.now(), accountId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function feedAccounts(userId: string, accountId?: string): FeedAccount[] {
  const rows = db
    .prepare("SELECT id, synced_at FROM accounts WHERE user_id = ? AND in_feed = 1 AND needs_relink = 0 ORDER BY created_at")
    .all(userId) as FeedAccount[];
  return accountId ? rows.filter((a) => a.id === accountId) : rows;
}

/** Sync every feed account; one failing account doesn't block the others. */
async function syncAll(accounts: FeedAccount[]) {
  await Promise.all(
    accounts.map((a) =>
      syncSubscriptions(a.id).catch((error) => {
        if (!(error instanceof RelinkRequired)) console.warn(`subscription sync failed for ${a.id}:`, (error as Error).message);
      }),
    ),
  );
}

/** Merged channel list across accounts, with the accounts each came through. */
function mergedChannels(userId: string, accounts: FeedAccount[]): Channel[] {
  if (!accounts.length) return [];
  const ids = accounts.map((a) => a.id);
  const rows = db
    .prepare(
      `SELECT s.channel_id, s.title, s.avatar, s.account_id, g.grp FROM subscriptions s
       LEFT JOIN channel_groups g ON g.user_id = ? AND g.channel_id = s.channel_id
       WHERE s.account_id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(userId, ...ids) as { channel_id: string; title: string; avatar: string | null; account_id: string; grp: string | null }[];
  const map = new Map<string, Channel>();
  for (const r of rows) {
    const existing = map.get(r.channel_id);
    if (existing) existing.via!.push(r.account_id);
    else
      map.set(r.channel_id, {
        id: r.channel_id,
        provider: "youtube",
        name: r.title,
        avatar: proxyImage(r.avatar ?? undefined),
        group: r.grp ?? undefined,
        unseen: 0,
        via: [r.account_id],
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

export async function subscriptions(userId: string): Promise<Channel[]> {
  const accounts = feedAccounts(userId);
  await syncAll(accounts);
  const channels = mergedChannels(userId, accounts);
  // Count recent uploads from whatever RSS is already cached or quick to fetch.
  await mapLimit(channels, 8, async (c) => {
    const entries = await rss(c.id).catch(() => []);
    c.unseen = entries.filter((e) => !e.short && Date.now() - Date.parse(e.published) < NEW_WINDOW).length;
  });
  return channels;
}

export async function feed(userId: string, opts: { accountId?: string; group?: string; limit?: number }): Promise<Video[]> {
  const accounts = feedAccounts(userId, opts.accountId);
  if (!accounts.length) return [];
  await syncAll(accounts);
  const channels = mergedChannels(userId, accounts).filter((c) => !opts.group || c.group === opts.group);
  const perChannel = await mapLimit(channels, 8, async (c) => ({ channel: c, entries: await rss(c.id).catch(() => [] as RssEntry[]) }));

  const items = perChannel
    .flatMap(({ channel, entries }) => entries.filter((e) => !e.short).map((e) => ({ channel, e })))
    .sort((a, b) => b.e.published.localeCompare(a.e.published))
    .slice(0, opts.limit ?? 120);

  const ids = items.map(({ e }) => e.id);
  const [statsOf, community] = await Promise.all([enrich(accounts[0]!.id, ids), titles(ids.slice(0, 60))]);

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

/** Which of the user's accounts (in the feed or not) subscribe to a channel. */
export function subscribers(userId: string, channelId: string): string[] {
  return (
    db
      .prepare("SELECT s.account_id FROM subscriptions s JOIN accounts a ON a.id = s.account_id WHERE a.user_id = ? AND s.channel_id = ?")
      .all(userId, channelId) as { account_id: string }[]
  ).map((r) => r.account_id);
}
