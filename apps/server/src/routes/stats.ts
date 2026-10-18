import { Hono } from "hono";
import type { WatchBeat, WatchStats, WatchStatsChannel, WatchStatsItem, WatchTotals } from "@tube/shared";
import { db } from "../db.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";

/**
 * Watch time and the analytics built from it. The player reports what was actually played (not
 * just opened) in short beats; each is added to the item's row for the viewer's local day and
 * hour, so "minutes per day" and "when do I watch" use their own clock. Only this profile sees it.
 */
export const statsRoutes = new Hono<AppEnv>();
statsRoutes.use("*", requireUser);

const DAY_MS = 864e5;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    } catch {
      // Unknown time zone: count it as UTC.
      return formatter("UTC");
    }
    formatters.set(tz, f);
  }
  return f;
}

/** The viewer's local date (YYYY-MM-DD) and hour for a moment. */
function local(tz: string, at = Date.now()) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(at).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** A date string moved by whole days. */
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

const num = (value: unknown, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

statsRoutes.post("/watch", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<WatchBeat> | null;
  if (!body || typeof body.key !== "string" || !/^[a-z0-9-]+\/[^\s/]{1,200}$/i.test(body.key)) throw fail(422, "Expected a watch beat.");
  const user = c.get("user").id;
  // A beat covers at most a few minutes of playback; anything more is a bad clock, not viewing.
  const seconds = num(body.seconds, 600);
  const media = num(body.media, 1800);
  const skipped = num(body.skipped, 4 * 3600);
  const finished = body.finished ? 1 : 0;
  if (!seconds && !skipped && !finished) return c.json({ ok: true });
  const backend = body.key.split("/")[0]!;
  const channelId = text(body.channelId, 200);
  // Thumbnails are core's own proxied paths; never store a URL elsewhere.
  const thumbnail = typeof body.thumbnail === "string" && body.thumbnail.startsWith("/api/") ? body.thumbnail.slice(0, 2000) : null;
  const now = Date.now();
  db.prepare(
    `INSERT INTO watch_items (user_id, item_key, backend, kind, title, channel_key, channel_name, category, thumbnail, duration, first_at, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_key) DO UPDATE SET title = excluded.title, channel_name = excluded.channel_name,
       category = COALESCE(excluded.category, category), thumbnail = COALESCE(excluded.thumbnail, thumbnail),
       duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE duration END, last_at = excluded.last_at`,
  ).run(
    user,
    body.key,
    backend,
    body.kind === "episode" ? "episode" : "video",
    text(body.title, 300),
    `${backend}:${channelId}`,
    text(body.channelName, 200),
    text(body.category, 60) || null,
    thumbnail,
    Math.round(num(body.duration, 24 * 3600)),
    now,
    now,
  );
  const { day, hour } = local(text(body.tz, 64) || "UTC", now);
  db.prepare(
    `INSERT INTO watch_time (user_id, item_key, day, hour, seconds, media, skipped, finished) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_key, day, hour) DO UPDATE SET seconds = seconds + excluded.seconds, media = media + excluded.media,
       skipped = skipped + excluded.skipped, finished = MAX(finished, excluded.finished)`,
  ).run(user, body.key, day, hour, seconds, media, skipped, finished);
  return c.json({ ok: true });
});

statsRoutes.delete("/stats", (c) => {
  const user = c.get("user").id;
  db.prepare("DELETE FROM watch_time WHERE user_id = ?").run(user);
  db.prepare("DELETE FROM watch_items WHERE user_id = ?").run(user);
  return c.json({ ok: true });
});

type Row = {
  item_key: string;
  day: string;
  hour: number;
  seconds: number;
  media: number;
  skipped: number;
  finished: number;
};
type ItemRow = {
  item_key: string;
  backend: string;
  kind: "video" | "episode";
  title: string;
  channel_key: string;
  channel_name: string;
  category: string | null;
  thumbnail: string | null;
  duration: number;
  first_at: number;
  last_at: number;
};

function totals(rows: Row[], items: Map<string, ItemRow>): WatchTotals {
  const keys = new Set(rows.filter((r) => r.seconds >= 5 || r.finished).map((r) => r.item_key));
  return {
    seconds: rows.reduce((n, r) => n + r.seconds, 0),
    media: rows.reduce((n, r) => n + r.media, 0),
    skipped: rows.reduce((n, r) => n + r.skipped, 0),
    items: keys.size,
    finished: new Set(rows.filter((r) => r.finished).map((r) => r.item_key)).size,
    channels: new Set([...keys].map((k) => items.get(k)?.channel_key).filter(Boolean)).size,
    activeDays: new Set(rows.filter((r) => r.seconds > 0).map((r) => r.day)).size,
  };
}

/** Consecutive days with at least a minute watched, ending today (or yesterday) and overall. */
function streaks(days: string[], today: string) {
  const set = new Set(days);
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const day of [...set].sort()) {
    run = previous && shift(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  let current = 0;
  let cursor = set.has(today) ? today : shift(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = shift(cursor, -1);
  }
  return { current, longest };
}

const splitKey = (key: string, sep: string) => {
  const i = key.indexOf(sep);
  return { backend: key.slice(0, i), id: key.slice(i + 1) };
};

statsRoutes.get("/stats", (c) => {
  const user = c.get("user").id;
  const tz = c.req.query("tz") || "UTC";
  const days = Math.max(0, Math.min(Math.floor(Number(c.req.query("days") ?? 30)) || 0, 3660));
  const today = local(tz).day;

  const itemRows = db.prepare("SELECT * FROM watch_items WHERE user_id = ?").all(user) as ItemRow[];
  const items = new Map(itemRows.map((i) => [i.item_key, i]));
  const all = db.prepare("SELECT item_key, day, hour, seconds, media, skipped, finished FROM watch_time WHERE user_id = ? ORDER BY day").all(user) as Row[];

  const first = all[0]?.day ?? today;
  const from = days ? shift(today, -(days - 1)) : first < today ? first : today;
  const rows = all.filter((r) => r.day >= from && r.day <= today);
  const before = days ? all.filter((r) => r.day >= shift(from, -days) && r.day < from) : null;

  // Day by day, split by service.
  const daily = new Map<string, { day: string; seconds: number; byBackend: Record<string, number> }>();
  for (let d = from; d <= today; d = shift(d, 1)) daily.set(d, { day: d, seconds: 0, byBackend: {} });
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const byBackend = new Map<string, { seconds: number; items: Set<string> }>();
  type ChannelTally = { seconds: number; media: Map<string, number>; finished: Set<string>; lastAt: number; latest?: ItemRow };
  const byChannel = new Map<string, ChannelTally>();
  const byItem = new Map<string, { seconds: number; media: number }>();
  const byCategory = new Map<string, number>();
  const finishedByShowDay = new Map<string, number>();

  for (const r of rows) {
    const item = items.get(r.item_key);
    const backend = item?.backend ?? r.item_key.split("/")[0]!;
    const entry = daily.get(r.day);
    if (entry) {
      entry.seconds += r.seconds;
      entry.byBackend[backend] = (entry.byBackend[backend] ?? 0) + r.seconds;
    }
    heatmap[weekday(r.day)]![r.hour]! += r.seconds;
    const b = byBackend.get(backend) ?? { seconds: 0, items: new Set() };
    b.seconds += r.seconds;
    b.items.add(r.item_key);
    byBackend.set(backend, b);
    const it = byItem.get(r.item_key) ?? { seconds: 0, media: 0 };
    it.seconds += r.seconds;
    it.media += r.media;
    byItem.set(r.item_key, it);
    if (!item) continue;
    const ch: ChannelTally = byChannel.get(item.channel_key) ?? { seconds: 0, media: new Map(), finished: new Set(), lastAt: 0 };
    ch.seconds += r.seconds;
    ch.media.set(r.item_key, (ch.media.get(r.item_key) ?? 0) + r.media);
    if (r.finished) ch.finished.add(r.item_key);
    if (item.last_at >= ch.lastAt) {
      ch.lastAt = item.last_at;
      ch.latest = item;
    }
    byChannel.set(item.channel_key, ch);
    if (item.category) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + r.seconds);
    if (r.finished && item.kind === "episode") {
      const k = `${r.day}|${item.channel_key}`;
      finishedByShowDay.set(k, (finishedByShowDay.get(k) ?? 0) + 1);
    }
  }

  const channels: WatchStatsChannel[] = [...byChannel]
    .map(([key, ch]): WatchStatsChannel => {
      const { backend, id } = splitKey(key, ":");
      const shares = [...ch.media].map(([k, media]) => {
        const duration = items.get(k)?.duration ?? 0;
        return ch.finished.has(k) ? 1 : duration ? Math.min(media / duration, 1) : 0;
      });
      return {
        key,
        backend,
        id,
        name: ch.latest?.channel_name ?? "",
        kind: ch.latest?.kind ?? "video",
        thumbnail: ch.latest?.thumbnail ?? undefined,
        seconds: ch.seconds,
        items: ch.media.size,
        finished: ch.finished.size,
        completion: shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0,
        lastAt: ch.lastAt,
      };
    })
    .filter((ch) => ch.seconds >= 30)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 24);

  const topItems: WatchStatsItem[] = [...byItem]
    .map(([key, it]): WatchStatsItem | null => {
      const item = items.get(key);
      if (!item) return null;
      const { backend, id } = splitKey(key, "/");
      return {
        key,
        backend,
        id,
        title: item.title,
        channelName: item.channel_name,
        thumbnail: item.thumbnail ?? undefined,
        duration: item.duration,
        seconds: it.seconds,
        plays: item.duration ? it.media / item.duration : 0,
      };
    })
    .filter((i): i is WatchStatsItem => i !== null && i.seconds >= 30)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 12);

  const topDay = [...daily.values()].reduce<{ day: string; seconds: number } | undefined>(
    (best, d) => (d.seconds > (best?.seconds ?? 0) ? { day: d.day, seconds: d.seconds } : best),
    undefined,
  );
  const bingeEntry = [...finishedByShowDay].sort((a, b) => b[1] - a[1])[0];
  const binge =
    bingeEntry && bingeEntry[1] >= 2
      ? (() => {
          const [day, key] = bingeEntry[0].split("|") as [string, string];
          return { day, key, name: byChannel.get(key)?.latest?.channel_name ?? "", episodes: bingeEntry[1] };
        })()
      : undefined;

  // Streaks count days with at least a minute watched, across all time.
  const perDay = new Map<string, number>();
  for (const r of all) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.seconds);

  const stats: WatchStats = {
    days,
    from,
    to: today,
    totals: totals(rows, items),
    previous: before ? totals(before, items) : undefined,
    daily: [...daily.values()],
    heatmap,
    backends: [...byBackend].map(([backend, b]) => ({ backend, seconds: b.seconds, items: b.items.size })).sort((a, b) => b.seconds - a.seconds),
    channels,
    items: topItems,
    categories: [...byCategory].map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds).slice(0, 8),
    topDay,
    binge,
    streak: streaks([...perDay].filter(([, s]) => s >= 60).map(([d]) => d), today),
    since: itemRows.length ? Math.min(...itemRows.map((i) => i.first_at)) : undefined,
  };
  return c.json(stats);
});
