/*
 * Crunchyroll's catalogue in Fanoos' shared shapes: shows become Channels (kind "series"),
 * episodes become Videos with `episode` details. Catalogue data is the same for everyone and
 * cached by id; watchlist and history are per account and cached briefly.
 */
import type { Channel, Segment, Video } from "@tube/shared";
import { mapLimit, SharedCache } from "../../kit/src/cache.ts";
import { api, publicJson } from "./client.ts";
import { proxyImage } from "./media.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Img = { width: number; height: number; source: string };

/** The smallest image at least `width` wide (or the largest there is). */
function pick(sets: Img[][] | Img[] | undefined, width: number): string | undefined {
  const list = (Array.isArray(sets?.[0]) ? (sets as Img[][])[0] : (sets as Img[] | undefined)) ?? [];
  const sorted = [...list].filter((i) => i?.source).sort((a, b) => a.width - b.width);
  return proxyImage((sorted.find((i) => i.width >= width) ?? sorted.at(-1))?.source);
}

const maturity = (m: Any): string | undefined => {
  const r = m?.extended_maturity_rating?.rating ?? m?.maturity_ratings?.[0];
  return r ? `${r}${/^\d+$/.test(r) ? "+" : ""}` : undefined;
};

/** Any episode-shaped object (watchlist panel, season list item, object lookup) → Video. */
export function toVideo(item: Any): Video {
  const m = item.episode_metadata ?? item;
  // When it became watchable, else when it aired. Crunchyroll fills unknown dates with
  // placeholders (2001-01-02 for older catalogue, 9998-… for "never"), so skip implausible ones.
  const plausible = (d: string | null | undefined) => Boolean(d) && Number(d!.slice(0, 4)) >= 2006 && Number(d!.slice(0, 4)) < 9000;
  const published =
    [m.premium_available_date, m.availability_starts, m.episode_air_date, m.upload_date].find(plausible) ?? m.episode_air_date ?? new Date(0).toISOString();
  return {
    id: item.id,
    provider: "crunchyroll",
    title: item.title ?? "",
    channelId: m.series_id,
    channelName: m.series_title ?? "",
    duration: Math.round((m.duration_ms ?? 0) / 1000),
    views: 0,
    viewsApprox: true,
    published,
    description: item.description ?? "",
    thumbnail: pick(item.images?.thumbnail, 640) ?? "",
    premium: Boolean(m.is_premium_only),
    rating: maturity(m),
    episode: {
      seriesId: m.series_id,
      seriesTitle: m.series_title ?? "",
      seasonId: m.season_id,
      seasonTitle: m.season_title,
      season: m.season_number,
      number: m.episode || (m.episode_number != null ? String(m.episode_number) : undefined),
      audio: m.audio_locale || undefined,
      versions: (m.versions ?? []).map((v: Any) => ({ audio: v.audio_locale, id: v.guid, original: Boolean(v.original) })),
      subtitles: m.subtitle_locales ?? [],
      nextId: item.next_episode_id || undefined,
    },
  };
}

/** A series object → Channel (kind "series"). */
export function toSeries(item: Any): Channel {
  const m = item.series_metadata ?? item;
  return {
    id: item.id,
    provider: "crunchyroll",
    kind: "series",
    name: item.title ?? "",
    description: item.description ?? item.extended_description ?? "",
    avatar: pick(item.images?.poster_tall, 120),
    poster: pick(item.images?.poster_tall, 480),
    banner: pick(item.images?.poster_wide, 1600),
    videoCount: m.episode_count,
    unseen: 0,
  };
}

const L = 30 * 60; // catalogue: 30 minutes fresh
const objectCache = new SharedCache<Any>("object", { ttlSeconds: L });
const seasonsCache = new SharedCache<Any[]>("seasons", { ttlSeconds: L });
const episodesCache = new SharedCache<Any[]>("episodes", { ttlSeconds: 10 * 60 });
const searchCache = new SharedCache<{ series: Any[]; episodes: Any[] }>("search");
const skipCache = new SharedCache<Segment[]>("skip", { ttlSeconds: 24 * 3600 });
const watchlistCache = new SharedCache<Any[]>("watchlist", { ttlSeconds: 120 });
const historyCache = new SharedCache<Any[]>("history", { ttlSeconds: 60 });

/** Episodes, series or seasons by id, from cache or one batched lookup. */
export async function objects(ref: string, ids: string[]): Promise<Any[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { values } = await objectCache.getMany(unique);
  const missing = unique.filter((id) => !values.has(id));
  for (let i = 0; i < missing.length; i += 40) {
    const batch = missing.slice(i, i + 40);
    const res = await api<{ data: Any[] }>(ref, `/content/v2/cms/objects/${batch.join(",")}`);
    await objectCache.setMany((res?.data ?? []).map((o) => [o.id, o] as [string, Any]));
    for (const o of res?.data ?? []) values.set(o.id, o);
  }
  return unique.map((id) => values.get(id)).filter(Boolean);
}

export const object = async (ref: string, id: string) => (await objects(ref, [id]))[0] ?? null;

export const seasons = (ref: string, seriesId: string) =>
  seasonsCache.get(seriesId, async () => (await api<{ data: Any[] }>(ref, `/content/v2/cms/series/${seriesId}/seasons`)).data ?? []);

export const episodes = (ref: string, seasonId: string) =>
  episodesCache.get(seasonId, async () => (await api<{ data: Any[] }>(ref, `/content/v2/cms/seasons/${seasonId}/episodes`)).data ?? []);

export async function upNext(ref: string, seriesId: string): Promise<{ id: string; playhead: number } | null> {
  const res = await api<{ data: Any[] }>(ref, `/content/v2/discover/up_next/${seriesId}`).catch(() => null);
  const first = res?.data?.[0];
  return first?.panel?.id ? { id: first.panel.id, playhead: first.playhead ?? 0 } : null;
}

/** The account's watchlist: one panel per show (its next or newest episode). */
export const watchlist = (ref: string) =>
  watchlistCache.get(ref, async () => (await api<{ data: Any[] }>(ref, "/content/v2/discover/{account}/watchlist", { query: { n: "100" } })).data ?? []);

/** Recently played episodes with positions, newest first. */
export const history = (ref: string) =>
  historyCache.get(ref, async () => (await api<{ data: Any[] }>(ref, "/content/v2/{account}/watch-history", { query: { page_size: "40" } })).data ?? []);

export const forget = (ref: string) => Promise.all([watchlistCache.delete(ref), historyCache.delete(ref)]);

export async function search(ref: string, q: string) {
  return searchCache.get(q.toLowerCase(), async () => {
    const res = await api<{ data: { type: string; items: Any[] }[] }>(ref, "/content/v2/discover/search", { query: { q, n: "24", type: "series,episode" } });
    const of = (type: string) => res?.data?.find((d) => d.type === type)?.items ?? [];
    return { series: of("series"), episodes: of("episode") };
  });
}

/** Intro, credits, recap and preview markers, as segments the player can skip. */
export function skipSegments(id: string): Promise<Segment[]> {
  return skipCache.get(id, async () => {
    const data = await publicJson<Record<string, Any>>(`https://static.crunchyroll.com/skip-events/production/${id}.json`);
    if (!data) return [];
    const map: Record<string, Segment["category"]> = { intro: "intro", credits: "outro", recap: "preview", preview: "preview" };
    return Object.entries(map)
      .map(([key, category]): Segment | null => {
        const e = data[key];
        return e && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start ? { start: e.start, end: e.end, category } : null;
      })
      .filter((s): s is Segment => s !== null);
  });
}

/** Load series details for many ids (watchlist shows), bounded. */
export async function seriesMany(ref: string, ids: string[]): Promise<Map<string, Channel>> {
  const out = new Map<string, Channel>();
  const found = await objects(ref, ids);
  for (const o of found) out.set(o.id, toSeries(o));
  // Anything the batch lookup missed (rare), one by one.
  await mapLimit(
    ids.filter((id) => !out.has(id)),
    4,
    async (id) => {
      const res = await api<{ data: Any[] }>(ref, `/content/v2/cms/series/${id}`).catch(() => null);
      if (res?.data?.[0]) out.set(id, toSeries(res.data[0]));
    },
  );
  return out;
}
