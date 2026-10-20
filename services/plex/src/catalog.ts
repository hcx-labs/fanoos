import type { Channel, Video } from "@tube/shared";
import { itemId } from "./ids.ts";
import { seal } from "./crypto.ts";
import type { PlexItem, PlexLibrary, Server } from "./types.ts";
export function image(ref: string, server: Server, path?: string): string | undefined {
 if (!path || !path.startsWith("/") || path.startsWith("//")) return undefined;
 return `/public/image/${seal({ ref, server: server.id, path }, 7 * 86400)}`;
}
export function libraryChannel(ref: string, server: Server, library: PlexLibrary): Channel {
 return { id: itemId(server.id, library.key, true), provider: "plex", kind: "library", libraryType: library.type === "show" ? "shows" : "movies", name: library.title, handle: server.name, description: `${library.type === "show" ? "TV shows" : "Movies"} on ${server.name}`, avatar: image(ref, server, library.thumb), banner: image(ref, server, library.art), unseen: 0, via: [ref] };
}
export function showChannel(ref: string, server: Server, item: PlexItem): Channel {
 return { id: itemId(server.id, item.ratingKey), provider: "plex", kind: "series", year: item.year, url: `https://app.plex.tv/desktop/#!/server/${server.id}/details?key=%2Flibrary%2Fmetadata%2F${item.ratingKey}`, name: item.title, description: item.summary, poster: image(ref, server, item.thumb), avatar: image(ref, server, item.thumb), banner: image(ref, server, item.art), videoCount: item.leafCount, unseen: 0, via: [ref] };
}
export function movieChannel(ref: string, server: Server, item: PlexItem): Channel {
 return { ...showChannel(ref, server, item), kind: "movie", videoCount: undefined };
}
export function video(ref: string, server: Server, item: PlexItem, section?: string | number): Video {
 const episode = item.type === "episode";
 const parent = item.grandparentRatingKey ?? "0";
 return {
  id: itemId(server.id, item.ratingKey), kind: item.type === "movie" ? "movie" : "episode", year: item.year, poster: item.type === "movie" ? image(ref, server, item.thumb) : undefined, provider: "plex", url: `https://app.plex.tv/desktop/#!/server/${server.id}/details?key=%2Flibrary%2Fmetadata%2F${item.ratingKey}`, title: item.title,
  channelId: episode ? itemId(server.id, parent) : itemId(server.id, item.ratingKey),
  libraryId: section || item.librarySectionID ? itemId(server.id, section ?? item.librarySectionID!, true) : undefined,
  channelName: episode ? item.grandparentTitle || "TV" : item.title,
  channelAvatar: image(ref, server, item.grandparentThumb), duration: (item.duration ?? 0) / 1000,
  views: item.viewCount ?? 0, published: item.originallyAvailableAt ? new Date(item.originallyAvailableAt).toISOString() : item.year ? `${item.year}-01-01T00:00:00.000Z` : "", addedAt: new Date((item.addedAt ?? 0) * 1000).toISOString(), description: item.summary || "",
  thumbnail: image(ref, server, item.type === "movie" ? item.art || item.thumb : item.thumb) || "", progress: (item.viewOffset ?? 0) / 1000, rating: item.contentRating,
  episode: episode ? { seriesId: itemId(server.id, parent), seriesTitle: item.grandparentTitle || "TV", seasonId: item.parentRatingKey ? itemId(server.id, item.parentRatingKey) : undefined, seasonTitle: item.parentTitle, season: item.parentIndex, number: item.index === undefined ? undefined : String(item.index) } : undefined,
  chapters: item.Chapter?.map((c) => ({ title: c.tag || "Chapter", start: c.startTimeOffset / 1000 })),
  segments: item.Marker?.filter((m) => ["intro", "credits"].includes(m.type)).map((m) => ({ category: m.type === "intro" ? "intro" : "outro", start: m.startTimeOffset / 1000, end: m.endTimeOffset / 1000 })), via: [ref],
 };
}
