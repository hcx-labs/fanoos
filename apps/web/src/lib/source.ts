/*
 * Data access for pages. The server merges every linked account's subscriptions
 * and proxies all YouTube traffic; this is just a typed client over its API.
 */
import { useMemo } from "react";
import { api, qs } from "./api";
import { useAccounts } from "./session";
import type { Channel, Comment, CommentPage, CommentSort, Playlist, SearchFilters, SearchResults, Video, VideoDetail } from "./types";

export type Rating = "like" | "dislike" | "none";

export type { CommentSort, SearchFilters };

// Last results, kept in memory so search suggestions never leave the device.
let recentChannels: Channel[] = [];
let recentVideos: Video[] = [];

const source = {
  async subscriptions() {
    const channels = await api<Channel[]>("/subscriptions");
    recentChannels = channels;
    return channels;
  },
  async feed({ group, accountId }: { group?: string; accountId?: string } = {}) {
    const videos = await api<Video[]>(`/feed${qs({ group, account: accountId })}`);
    if (!group && !accountId) recentVideos = videos;
    return videos;
  },
  playlists: () => api<Playlist[]>("/playlists"),
  subscribers: (channel: { id: string }) => api<string[]>(`/channels/${channel.id}/subscribers`),
  setGroup: (channelId: string, group: string | null) => api(`/channels/${channelId}/group`, { method: "PUT", body: { group } }),
  video: (id: string) => api<VideoDetail>(`/videos/${id}`),
  comments: (id: string, sort: CommentSort, next?: string) => api<CommentPage>(`/videos/${id}/comments${qs({ sort, next })}`),
  replies: (token: string) => api<CommentPage>(`/comments/replies${qs({ token })}`),
  channel: (id: string) => api<{ channel: Channel; videos: Video[] }>(`/channels/${id}`),
  search: (query: string, filters: SearchFilters) => api<SearchResults>(`/search${qs({ q: query, ...filters })}`),
  // Actions as a linked account (needs write permission).
  setSubscribed: (accountId: string, channelId: string, subscribed: boolean) =>
    api("/actions/subscriptions", { body: { accountId, channelId, subscribed } }),
  rating: (accountId: string, videoId: string) => api<{ rating: Rating }>(`/actions/rating${qs({ accountId, videoId })}`),
  rate: (accountId: string, videoId: string, rating: Rating) => api("/actions/rating", { body: { accountId, videoId, rating } }),
  comment: (accountId: string, videoId: string, text: string, parentId?: string) =>
    api<Comment>("/actions/comments", { body: { accountId, videoId, text, parentId } }),
  /** Channel id for a YouTube handle or custom-URL link. */
  resolve: (url: string) => api<{ channelId: string }>(`/resolve${qs({ url })}`),
  videos: (ids: string[]) => (ids.length ? api<Video[]>(`/videos${qs({ ids: ids.join(",") })}`) : Promise.resolve([])),
};

export type Source = typeof source & { key: string };

/** The client plus a `key` that changes whenever account-dependent results would. */
export function useSource(): Source {
  const { inFeed, active } = useAccounts();
  const key = `${inFeed.map((a) => a.id).join(",")}|${active?.id ?? ""}`;
  return useMemo(() => ({ ...source, key }), [key]);
}

/** Instant suggestions from what this device already loaded; no keystrokes leave the browser. */
export function suggest(query: string): { channels: Channel[]; videos: Video[] } {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { channels: [], videos: [] };
  const hit = (text: string) => terms.every((t) => text.toLowerCase().includes(t));
  return {
    channels: recentChannels.filter((c) => hit(c.name)).slice(0, 3),
    videos: recentVideos.filter((v) => hit(`${v.title} ${v.altTitle ?? ""}`)).slice(0, 5),
  };
}
