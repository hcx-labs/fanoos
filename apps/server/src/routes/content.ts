import { Hono } from "hono";
import type { CommentSort, Playlist, SearchFilters, SearchResults, VideoDetail } from "@tube/shared";
import { SharedCache } from "../cache.ts";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { fetchPlaylists, RelinkRequired } from "../google.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";
import { proxyImage } from "../media.ts";
import { communityTitle, segments, votes } from "../youtube/extras.ts";
import { feed, subscribers, subscriptions } from "../youtube/feed.ts";
import { channelPage, comments, replies, search, videoDetail, yt } from "../youtube/innertube.ts";
import { dashManifest, playability } from "../youtube/stream.ts";

export const contentRoutes = new Hono<AppEnv>();
contentRoutes.use("*", requireUser);

const videoId = (id: string) => {
  if (!/^[\w-]{11}$/.test(id)) throw fail(400, "Invalid video id.");
  return id;
};
const channelId = (id: string) => {
  if (!/^UC[\w-]{22}$/.test(id)) throw fail(400, "Invalid channel id.");
  return id;
};

/** Wrap upstream failures (YouTube changes, network) in a clear 502. */
async function upstream<T>(label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RelinkRequired) throw fail(409, "A linked account needs to be linked again.", "relink");
    if ((error as { status?: number }).status) throw error;
    console.warn(`${label} failed:`, (error as Error).message);
    throw fail(502, `Couldn't load ${label} from YouTube.`, "upstream");
  }
}

contentRoutes.get("/subscriptions", async (c) => c.json(await upstream("subscriptions", () => subscriptions(c.get("user").id))));

contentRoutes.get("/feed", async (c) =>
  c.json(
    await upstream("your feed", () =>
      feed(c.get("user").id, { accountId: c.req.query("account") || undefined, group: c.req.query("group") || undefined }),
    ),
  ),
);

contentRoutes.get("/channels/:id/subscribers", (c) => c.json(subscribers(c.get("user").id, channelId(c.req.param("id")))));

contentRoutes.put("/channels/:id/group", async (c) => {
  const { group } = await c.req.json<{ group?: string | null }>();
  const id = channelId(c.req.param("id"));
  if (group?.trim()) {
    db.prepare("INSERT OR REPLACE INTO channel_groups (user_id, channel_id, grp) VALUES (?, ?, ?)").run(c.get("user").id, id, group.trim().slice(0, 40));
  } else {
    db.prepare("DELETE FROM channel_groups WHERE user_id = ? AND channel_id = ?").run(c.get("user").id, id);
  }
  return c.json({ ok: true });
});

contentRoutes.get("/playlists", async (c) => {
  const accounts = db.prepare("SELECT id FROM accounts WHERE user_id = ? AND needs_relink = 0").all(c.get("user").id) as { id: string }[];
  const lists = await Promise.all(
    accounts.map(async (a) => {
      try {
        return await playlistCache.get(a.id, async () =>
          (await fetchPlaylists(a.id)).map((p): Playlist => ({ ...p, accountId: a.id, thumbnail: proxyImage(p.thumbnail) })),
        );
      } catch {
        return [];
      }
    }),
  );
  return c.json(lists.flat());
});

/** Bump when the manifest or its segment-URL format changes. */
const MANIFEST_VERSION = 2;

const details = new SharedCache<Omit<VideoDetail, "stream">>("video");
const channels = new SharedCache<Awaited<ReturnType<typeof channelPage>>>("channel");
const searches = new SharedCache<SearchResults>("search");
const playlistCache = new SharedCache<Playlist[]>("playlists");
const channelCached = (id: string) => channels.get(id, () => channelPage(id));

/** Channels any of the user's linked accounts subscribe to. */
const followedChannels = (userId: string) =>
  new Set(
    (
      db.prepare("SELECT DISTINCT s.channel_id FROM subscriptions s JOIN accounts a ON a.id = s.account_id WHERE a.user_id = ?").all(userId) as {
        channel_id: string;
      }[]
    ).map((r) => r.channel_id),
  );

contentRoutes.get("/videos/:id", async (c) => {
  const id = videoId(c.req.param("id"));
  const detail = await upstream("this video", () => details.get(id, () => videoDetail(id)));
  const [segs, vote, alt, fromChannel, play] = await Promise.all([
    segments(id),
    votes(id),
    communityTitle(id).catch(() => undefined),
    channelCached(detail.channel.id).catch(() => null),
    playability(id).catch((): Awaited<ReturnType<typeof playability>> => ({ ok: false, code: "unplayable", reason: "Couldn't reach the streaming service." })),
  ]);
  // Up next: this channel's uploads, then related videos only from channels the user follows.
  // YouTube's recommendations for anything else are dropped.
  const followed = followedChannels(c.get("user").id);
  const seen = new Set([id]);
  // YouTube sometimes omits the watch page's owner block; fill gaps from the channel page.
  const page = fromChannel?.channel;
  const channel = {
    ...detail.channel,
    avatar: detail.channel.avatar || page?.avatar,
    subscribers: detail.channel.subscribers || page?.subscribers,
    verified: detail.channel.verified || page?.verified,
  };
  const next = [...(fromChannel?.videos ?? []), ...detail.next.filter((v) => followed.has(v.channelId))].filter((v) => !seen.has(v.id) && seen.add(v.id)).slice(0, 20);
  const body: VideoDetail = {
    ...detail,
    channel,
    next,
    video: { ...detail.video, channelAvatar: detail.video.channelAvatar || channel.avatar, channelVerified: channel.verified, segments: segs, likes: vote?.likes ?? detail.video.likes, dislikes: vote?.dislikes, altTitle: alt },
    stream: detail.video.live
      ? { unavailable: { code: "live", reason: "Live streams can't be played here yet." } }
      : play.ok
        ? // The version bypasses manifests browsers cached under an older stream-URL scheme.
          { dash: `/api/videos/${id}/manifest.mpd?v=${MANIFEST_VERSION}` }
        : { unavailable: { code: play.code, reason: play.reason } },
  };
  return c.json(body);
});

contentRoutes.get("/videos/:id/manifest.mpd", async (c) => {
  const id = videoId(c.req.param("id"));
  const mpd = await upstream("the video stream", () => dashManifest(id, config.publicUrl.origin));
  // Never cached: segment URLs expire, and a stale manifest breaks playback.
  return c.body(mpd, 200, { "content-type": "application/dash+xml", "cache-control": "no-store" });
});

contentRoutes.get("/videos/:id/comments", async (c) => {
  const sort: CommentSort = c.req.query("sort") === "new" ? "new" : "top";
  return c.json(await upstream("comments", () => comments(videoId(c.req.param("id")), sort, c.req.query("next") || undefined)));
});

contentRoutes.get("/comments/replies", async (c) => c.json(await upstream("replies", () => replies(c.req.query("token") ?? ""))));

// Channel handles and custom URLs (/@name, /c/name, /user/name) → channel id.
const resolved = new SharedCache<{ channelId: string } | null>("resolve");
const youtubeHost = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/;

contentRoutes.get("/resolve", async (c) => {
  let url: URL;
  try {
    url = new URL(c.req.query("url") ?? "");
  } catch {
    throw fail(400, "Not a link.");
  }
  if (url.protocol !== "https:" || !youtubeHost.test(url.hostname)) throw fail(400, "Not a YouTube link.");
  const result = await resolved.get(url.pathname.toLowerCase(), async () => {
    const endpoint: { payload?: { browseId?: string } } | undefined = await (await yt())
      .resolveURL(`https://www.youtube.com${url.pathname}`)
      .catch(() => undefined);
    const id = endpoint?.payload?.browseId;
    return id && /^UC[\w-]{22}$/.test(id) ? { channelId: id } : null;
  });
  if (!result) throw fail(404, "No channel found for that link.", "not_found");
  return c.json(result);
});

contentRoutes.get("/channels/:id", async (c) => c.json(await upstream("this channel", () => channelCached(channelId(c.req.param("id"))))));

contentRoutes.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  if (!q) return c.json({ channels: [], videos: [] });
  const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T) => (allowed.includes(value as T) ? (value as T) : fallback);
  const filters: SearchFilters = {
    type: pick(c.req.query("type"), ["all", "video", "channel"], "all"),
    duration: pick(c.req.query("duration"), ["any", "short", "medium", "long"], "any"),
    uploaded: pick(c.req.query("uploaded"), ["any", "today", "week", "month"], "any"),
    sort: pick(c.req.query("sort"), ["relevance", "date", "views"], "relevance"),
  };
  const key = `${q.toLowerCase()}|${filters.type}|${filters.duration}|${filters.uploaded}|${filters.sort}`;
  return c.json(await upstream("search results", () => searches.get(key, () => search(q, filters))));
});

/** Several videos by id (Watch later, history). Detail is cached, so this is cheap after first view. */
contentRoutes.get("/videos", async (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").filter((id) => /^[\w-]{11}$/.test(id)).slice(0, 50);
  const results = await Promise.all(ids.map((id) => details.get(id, () => videoDetail(id)).then((d) => d.video).catch(() => null)));
  return c.json(results.filter((v) => v !== null));
});
