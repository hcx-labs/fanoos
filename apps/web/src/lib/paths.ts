import type { Channel, Video } from "./types";

/** Anything that lives on a backend: its slug plus the backend's own id. */
export type ItemRef = { backend?: string; id: string };

/** Items from before backends were separate services are YouTube ones. */
const slugOf = (ref: ItemRef) => ref.backend ?? "youtube";

/** A stable key for an item across backends ("youtube/dQw4w9WgXcQ"); used for saved progress, history and lists. */
export const itemKey = (ref: ItemRef) => `${slugOf(ref)}/${ref.id}`;

export function parseKey(key: string): Required<ItemRef> {
  const slash = key.indexOf("/");
  return slash < 0 ? { backend: "youtube", id: key } : { backend: key.slice(0, slash), id: key.slice(slash + 1) };
}

/** The channel or show an item belongs to, as a ref. */
export const channelRef = (video: Pick<Video, "backend" | "channelId">): ItemRef => ({ backend: video.backend, id: video.channelId });

/** In-app URLs in one place; every item URL names its backend. */
export const paths = {
  watch: (video: ItemRef, time?: number) => `/watch/${slugOf(video)}/${video.id}${time ? `?t=${Math.floor(time)}` : ""}`,
  channel: (channel: ItemRef | Pick<Channel, "id" | "backend">) => `/channel/${slugOf(channel)}/${channel.id}`,
  channelOf: (video: Pick<Video, "backend" | "channelId">) => `/channel/${slugOf(channelRef(video))}/${video.channelId}`,
  search: (query: string, backend?: string) => `/search?q=${encodeURIComponent(query.trim())}${backend ? `&in=${backend}` : ""}`,
};
