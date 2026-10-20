/*
 * Data access for pages: a typed client over Fanoos core, which merges every backend
 * (YouTube, Crunchyroll, …) and routes single items to the backend named in their URL.
 */
import { useMemo } from "react";
import { api, qs } from "./api";
import type { ItemRef } from "./paths";
import { useAccounts } from "./session";
import type { Channel, ChannelAbout, ChannelPage, Comment, CommentPage, CommentSort, Playlist, ResolvedLink, SearchFilters, SearchResults, Video, VideoDetail } from "./types";

export type Rating = "like" | "dislike" | "none";

export type { CommentSort, SearchFilters };

/** One backend's search results. */
export type SearchSection = SearchResults & { backend: string; error?: string };

// Last results, kept in memory so search suggestions never leave the device.
let recentChannels: Channel[] = [];
let recentVideos: Video[] = [];

const v = (backend: string | undefined) => `/v/${backend ?? "youtube"}`;

const source = {
  async following() {
    const channels = await api<Channel[]>("/following");
    recentChannels = channels;
    return channels;
  },
  async feed({ group, accountId, backend, library }: { group?: string; accountId?: string; backend?: string; library?: string } = {}) {
    const videos = await api<Video[]>(`/feed${qs({ group, account: accountId, backend, library })}`);
    if (!group && !accountId && !backend) recentVideos = videos;
    return videos;
  },
  /** Started-but-unfinished items the services track themselves. */
  continueWatching: () => api<Video[]>("/continue"),
  playlists: () => api<Playlist[]>("/playlists"),
  channelAbout: (ref: ItemRef) => api<ChannelAbout>(`${v(ref.backend)}/channels/${ref.id}/about`),
  followers: (channel: ItemRef) => api<string[]>(`${v(channel.backend)}/channels/${channel.id}/followers`),
  setGroup: (channel: ItemRef, group: string | null) => api(`${v(channel.backend)}/channels/${channel.id}/group`, { method: "PUT", body: { group } }),
  video: (ref: ItemRef) => api<VideoDetail>(`${v(ref.backend)}/videos/${ref.id}`),
  comments: (ref: ItemRef, sort: CommentSort, next?: string) => api<CommentPage>(`${v(ref.backend)}/videos/${ref.id}/comments${qs({ sort, next })}`),
  replies: (backend: string | undefined, token: string) => api<CommentPage>(`${v(backend)}/comments/replies${qs({ token })}`),
  channel: (ref: ItemRef, section?: string, options: { next?: string; signal?: AbortSignal; query?: string; sort?: "new" | "popular" } = {}) =>
    api<ChannelPage>(`${v(ref.backend)}/channels/${ref.id}${qs({ section, next: options.next, q: options.query, sort: options.sort })}`, { signal: options.signal }),
  search: (query: string, filters: SearchFilters, backend?: string) => api<SearchSection[]>(`/search${qs({ q: query, backend, ...filters })}`),
  /** Several items by key, grouped per backend (Watch later, history). */
  async videos(refs: ItemRef[]) {
    const groups = new Map<string, string[]>();
    for (const r of refs) groups.set(r.backend ?? "youtube", [...(groups.get(r.backend ?? "youtube") ?? []), r.id]);
    const lists = await Promise.all([...groups].map(([backend, ids]) => api<Video[]>(`${v(backend)}/videos${qs({ ids: ids.join(",") })}`).catch(() => [] as Video[])));
    return lists.flat();
  },
  /** What a pasted link points to, and on which backend. */
  resolve: (url: string) => api<ResolvedLink & { backend: string }>(`/resolve${qs({ url })}`),
  // Acting as a linked account.
  follow: (accountId: string, channelId: string, on: boolean) => api("/actions/follow", { body: { accountId, channelId, on } }),
  rating: (accountId: string, videoId: string) => api<{ rating: Rating }>(`/actions/rating${qs({ accountId, videoId })}`),
  rate: (accountId: string, videoId: string, rating: Rating) => api("/actions/rating", { body: { accountId, videoId, rating } }),
  comment: (accountId: string, videoId: string, text: string, parentId?: string) => api<Comment>("/actions/comments", { body: { accountId, videoId, text, parentId } }),
  /** Tell services that track progress where playback is (fire and forget). */
  progress: (ref: ItemRef, position: number) => api("/actions/progress", { body: { backend: ref.backend, videoId: ref.id, position } }).catch(() => {}),
};

export type Source = typeof source & { key: string };

/** The client plus a `key` that changes whenever account-dependent results would. */
export function useSource(): Source {
  const { inFeed, active, accounts } = useAccounts();
  const key = `${inFeed.map((a) => a.id).join(",")}|${active?.id ?? ""}|${accounts.length}`;
  return useMemo(() => ({ ...source, key }), [key]);
}

/** Instant suggestions from what this device already loaded; no keystrokes leave the browser. */
export function suggest(query: string): { channels: Channel[]; videos: Video[] } {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { channels: [], videos: [] };
  const hit = (text: string) => terms.every((t) => text.toLowerCase().includes(t));
  return {
    channels: recentChannels.filter((c) => hit(c.name)).slice(0, 3),
    videos: recentVideos.filter((v) => hit(`${v.title} ${v.altTitle ?? ""} ${v.episode?.seriesTitle ?? ""}`)).slice(0, 5),
  };
}
