import type { Channel, Video } from "./types";

/**
 * In-app URLs in one place. Routes assume YouTube ids today; when another provider
 * lands, qualify them here (e.g. /watch/:provider/:id) and every link follows.
 */
export const paths = {
  watch: (video: Pick<Video, "id"> | string, time?: number) =>
    `/watch/${typeof video === "string" ? video : video.id}${time ? `?t=${Math.floor(time)}` : ""}`,
  channel: (channel: Pick<Channel, "id"> | string) => `/channel/${typeof channel === "string" ? channel : channel.id}`,
  search: (query: string) => `/search?q=${encodeURIComponent(query.trim())}`,
};
