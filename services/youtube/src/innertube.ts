/*
 * Public YouTube content through YouTube.js (Innertube), signed out: video
 * details, related videos, comments, channels and search. Playback goes through
 * the streaming companion instead (stream.ts).
 * YouTube changes these shapes often, so parsing is defensive and every
 * field degrades to an empty value instead of throwing.
 */
import { Innertube } from "youtubei.js";
import type { Channel, ChannelAbout, ChannelPage, Comment, CommentPage, CommentSort, SearchFilters, SearchResults, Video } from "@tube/shared";
import { TtlCache } from "./cache.ts";
import { ChannelCursors } from "./channel-cursors.ts";
import { channelDescription } from "./channel-description.ts";
import { channelList, channelListKey, type ChannelListOptions } from "./channel-list.ts";
import { randomToken } from "./crypto.ts";
import { proxyImage } from "./media.ts";
import { ago, chaptersFrom, clock, count, isRounded, text, thumb } from "./parse.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

let client: Promise<Innertube> | null = null;
let clientAge = 0;

/** Shared signed-out client, recreated every few hours to refresh visitor data and the player. */
export function yt(): Promise<Innertube> {
  if (!client || Date.now() - clientAge > 4 * 36e5) {
    clientAge = Date.now();
    client = Innertube.create({ retrieve_player: true, generate_session_locally: true }).catch((error) => {
      client = null;
      throw error;
    });
  }
  return client;
}

const avatarOf = (thumbnails: Node) => proxyImage(Array.isArray(thumbnails) ? thumbnails[0]?.url : undefined);

/** The newer "LockupView" card used in related videos, search and channel tabs. */
export function lockupToVideo(n: Node): Video | null {
  if (n?.type !== "LockupView" || n.content_type !== "VIDEO" || !n.content_id) return null;
  // Row layout varies by surface: related videos have [channel] then [views, age];
  // a channel's own videos tab has just [views, age]. Classify parts by content.
  const rows: string[][] = (n.metadata?.metadata?.metadata_rows ?? []).map((r: Node) => (r.metadata_parts ?? []).map((p: Node) => text(p.text)));
  const isAge = (t: string) => /\b(ago|streamed|premiered|scheduled)\b/i.test(t);
  const isViews = (t: string) => !isAge(t) && (/\b(views?|watching)\b/i.test(t) || /^[\d.,]+\s*[KMB]?$/i.test(t.trim()));
  const parts = rows.flat();
  const age = parts.find(isAge);
  const views = parts.find(isViews);
  const first = rows[0] ?? [];
  const channelName = first.length && !first.some((t) => isAge(t) || isViews(t)) ? first[0]! : "";
  const badges: string[] = (n.content_image?.overlays ?? []).flatMap((o: Node) => (o.badges ?? []).map((b: Node) => text(b.text)));
  const durationBadge = badges.find((b) => /^\d+(:\d+)+$/.test(b));
  const live = badges.some((b) => /live/i.test(b));
  const avatar = n.metadata?.image?.avatar?.image ?? n.metadata?.image?.avatars?.[0]?.image;
  const channelId = n.metadata?.image?.renderer_context?.command_context?.on_tap?.payload?.browseId ?? "";
  return {
    id: n.content_id,
    provider: "youtube",
    title: text(n.metadata?.title),
    channelId,
    channelName,
    channelAvatar: avatarOf(avatar),
    duration: durationBadge ? clock(durationBadge) : 0,
    views: count(views),
    viewsApprox: isRounded(views),
    published: ago(age),
    description: "",
    thumbnail: proxyImage(thumb(n.content_id, n.content_image?.image)),
    live,
  };
}

/** The classic "Video" node used by search results. */
function videoNode(v: Node): Video | null {
  const id = v?.id ?? v?.video_id;
  if (!id || (v.type !== "Video" && v.type !== "CompactVideo" && v.type !== "GridVideo")) return null;
  return {
    id,
    provider: "youtube",
    title: text(v.title),
    channelId: v.author?.id ?? "",
    channelName: v.author?.name ?? "",
    channelAvatar: avatarOf(v.author?.thumbnails),
    channelVerified: Boolean(v.author?.is_verified),
    duration: v.duration?.seconds ?? clock(v.length_text),
    views: count(v.view_count ?? v.short_view_count),
    viewsApprox: isRounded(v.view_count ?? v.short_view_count),
    published: ago(v.published),
    description: text(v.snippets?.[0]?.text ?? v.description_snippet),
    thumbnail: proxyImage(thumb(id, v.thumbnails)),
    live: Boolean(v.is_live),
    upcoming: Boolean(v.is_upcoming),
  };
}

const toVideo = (n: Node) => lockupToVideo(n) ?? videoNode(n);

export async function videoDetail(id: string): Promise<{ video: Video; channel: Channel; next: Video[] }> {
  const info = await (await yt()).getInfo(id);
  const b = info.basic_info;
  const owner: Node = info.secondary_info?.owner;
  const description = b.short_description ?? "";
  const published = info.primary_info?.published ? Date.parse(text(info.primary_info.published)) : NaN;
  const channel: Channel = {
    id: b.channel_id ?? owner?.author?.id ?? "",
    provider: "youtube",
    name: b.author ?? owner?.author?.name ?? "",
    avatar: avatarOf(owner?.author?.thumbnails),
    verified: Boolean(owner?.author?.is_verified),
    subscribers: count(owner?.subscriber_count),
    unseen: 0,
  };
  const video: Video = {
    id,
    provider: "youtube",
    title: b.title ?? "",
    channelId: channel.id,
    channelName: channel.name,
    channelAvatar: channel.avatar,
    channelVerified: channel.verified,
    duration: b.duration ?? 0,
    views: b.view_count ?? 0,
    likes: b.like_count ?? undefined,
    published: Number.isNaN(published) ? ago(info.primary_info?.relative_date) : new Date(published).toISOString(),
    description,
    thumbnail: proxyImage(thumb(id, b.thumbnail)),
    live: Boolean(b.is_live),
    upcoming: Boolean(b.is_upcoming),
    chapters: chaptersFrom(description),
  };
  const next = (info.watch_next_feed ?? []).map(toVideo).filter((v): v is Video => v !== null);
  return { video, channel, next };
}

// Comment continuations are live objects; keep them server-side behind opaque tokens.
const continuations = new TtlCache<Node>(30 * 60_000, 5000);
const remember = (value: Node) => {
  const token = randomToken(12);
  void continuations.get(token, async () => value);
  return token;
};

/** The continuation token for a thread's replies. YouTube puts it in either of two slots. */
function repliesToken(thread: Node): string | undefined {
  const data = thread?.comment_replies_data;
  const items: Node[] = [...(data?.contents ?? []), ...(data?.sub_threads ?? [])];
  return items.find((n) => n?.type === "ContinuationItem")?.endpoint?.payload?.token;
}

function toComment(thread: Node): Comment | null {
  const c = thread?.comment ?? thread;
  if (!c?.comment_id) return null;
  const replyCount = count(c.reply_count);
  return {
    id: c.comment_id,
    author: c.author?.name ?? "",
    avatar: avatarOf(c.author?.thumbnails),
    text: text(c.content),
    likes: count(c.like_count),
    publishedText: text(c.published_time),
    pinned: Boolean(c.is_pinned),
    hearted: Boolean(c.is_hearted),
    byCreator: Boolean(c.author_is_channel_owner),
    replyCount,
    replies: replyCount > 0 ? repliesToken(thread) : undefined,
  };
}

export async function comments(id: string, sort: CommentSort, next?: string): Promise<CommentPage> {
  const page: Node = next
    ? await (await continuations.get(next, () => Promise.reject(new Error("expired")))).getContinuation()
    : await (await yt()).getComments(id, sort === "new" ? "NEWEST_FIRST" : "TOP_COMMENTS");
  return {
    comments: (page.contents ?? []).map(toComment).filter((c: Comment | null): c is Comment => c !== null),
    count: page.header ? count(page.header.comments_count) : undefined,
    next: page.has_continuation ? remember(page) : undefined,
  };
}

/**
 * Replies by continuation token. Requested directly rather than through
 * CommentThread.getReplies(), which breaks when YouTube serves its alternate layout.
 */
export async function replies(token: string): Promise<CommentPage> {
  if (!/^[\w%=-]{20,4000}$/.test(token)) throw new Error("Invalid replies token");
  const res: Node = await (await yt()).actions.execute("/next", { continuation: token, parse: true });
  const items: Node[] = (res.on_response_received_endpoints ?? []).flatMap((e: Node) => e.contents ?? []);
  const more = items.find((n) => n?.type === "ContinuationItem");
  return {
    comments: items.map(toComment).filter((c): c is Comment => c !== null),
    next: more?.endpoint?.payload?.token ?? more?.button?.endpoint?.payload?.token,
  };
}

/** Browse metadata is an SEO teaser; the About endpoint carries the full description. */
export async function channelAbout(id: string): Promise<ChannelAbout> {
  const channel = await (await yt()).getChannel(id);
  const about = await channel.getAbout();
  return { description: channelDescription(about) };
}

const channelCursors = new ChannelCursors<ChannelPage>();
export const channelContinuation = (id: string, token: string, options: ChannelListOptions = {}) => channelCursors.next(channelListKey(id, options), token);

async function channelBatch(channel: Channel, tab: Node, paginate: boolean, scope: string): Promise<ChannelPage> {
  const videos = (tab.videos ?? []).map(toVideo).filter((video: Video | null): video is Video => video !== null)
    .map((video: Video) => ({ ...video, channelId: channel.id, channelName: channel.name }));
  const next = paginate && tab.has_continuation
    ? await channelCursors.remember(scope, async () => channelBatch(channel, await tab.getContinuation(), true, scope))
    : undefined;
  return { channel: { ...channel, avatar: channel.avatar || videos[0]?.channelAvatar }, videos, next };
}

export async function channelPage(id: string, paginate = false, options: ChannelListOptions = {}): Promise<ChannelPage> {
  const ch: Node = await (await yt()).getChannel(id);
  const header = JSON.stringify(ch.header ?? {});
  const meta = ch.metadata ?? {};
  const channel: Channel = {
    id,
    provider: "youtube",
    name: meta.title ?? "",
    handle: /"(@[\w.-]+)"/.exec(header)?.[1],
    avatar: avatarOf(meta.avatar),
    banner: proxyImage(ch.header?.content?.banner?.image?.[0]?.url ?? ch.header?.banner?.[0]?.url),
    description: meta.description ?? "",
    subscribers: count(/([\d.,]+[KMB]?) subscribers/i.exec(header)?.[1]),
    videoCount: count(/([\d.,]+[KMB]?) videos/i.exec(header)?.[1]),
    unseen: 0,
  };
  // Topic channels may have no uploads tab. Network failures must remain retryable errors.
  const list = await channelList(ch, options);
  if (!list) return { channel, videos: [] };
  return channelBatch(channel, list, paginate, channelListKey(id, options));
}

export async function search(query: string, filters: SearchFilters): Promise<SearchResults> {
  const result: Node = await (await yt()).search(query, {
    type: filters.type === "all" ? "all" : filters.type,
    duration: ({ any: "all", short: "under_three_mins", medium: "three_to_twenty_mins", long: "over_twenty_mins" } as const)[filters.duration],
    upload_date: filters.uploaded === "any" ? "all" : filters.uploaded,
    // YouTube no longer sorts by date; "Newest" re-sorts relevance results below.
    prioritize: filters.sort === "views" ? "popularity" : "relevance",
  });
  const nodes: Node[] = result.results ?? [];
  const channels: Channel[] = nodes
    .filter((n) => n.type === "Channel")
    .map((n) => ({
      id: n.id ?? n.author?.id,
      provider: "youtube" as const,
      name: n.author?.name ?? "",
      handle: text(n.subscriber_count).startsWith("@") ? text(n.subscriber_count) : undefined,
      avatar: avatarOf(n.author?.thumbnails),
      // YouTube currently puts the subscriber count in the video_count slot.
      subscribers: count(/subscriber/i.test(text(n.video_count)) ? n.video_count : n.subscriber_count),
      description: text(n.description_snippet),
      verified: Boolean(n.author?.is_verified),
      unseen: 0,
    }));
  const videos = nodes.map(toVideo).filter((v): v is Video => v !== null);
  if (filters.sort === "date") videos.sort((a, b) => b.published.localeCompare(a.published));
  return { channels, videos };
}
