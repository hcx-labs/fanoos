import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { PlaybackSource, Stream } from "@tube/shared";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { seal, open } from "./crypto.ts";
import { request, serverFor } from "./client.ts";
import { rewriteManifest } from "./manifest.ts";
import type { PlexItem, Server } from "./types.ts";
type Ticket = { ref: string; server: string; path?: string; session?: string; key?: string; height?: number; bitrate?: number };
const ttl = 8 * 3600;
export function playback(ref: string, server: Server, item: PlexItem): Stream {
 const media = item.Media?.[0]; const part = media?.Part?.[0];
 if (!part) return { unavailable: { code: "unplayable", reason: "Plex could not find a playable media file." } };
 const subtitles = (part.Stream ?? []).filter((s) => s.streamType === 3 && s.key && ["srt", "webvtt", "ass", "ssa", "mov_text"].includes(s.codec || "")).map((s) => ({ id: String(s.id), locale: s.languageCode || "und", label: s.displayTitle || s.language || "Subtitles", format: "vtt" as const, url: `/public/subtitle/${seal({ ref, server: server.id, path: `/library/streams/${s.id}?format=vtt` }, ttl)}` }));
 const height = media?.videoResolution === "4k" ? 2160 : Number(media?.videoResolution) || media?.height || 1080;
 const sources: PlaybackSource[] = [];
 if (media?.Part?.length === 1) sources.push({
  id: "original", kind: "original", label: `Original · ${height}p`, height, bitrate: (media.bitrate ?? 0) * 1000,
  description: `Direct play · ${[media.container?.toUpperCase(), media.videoCodec?.toUpperCase(), media.audioCodec?.toUpperCase()].filter(Boolean).join(" · ")}`,
  mimeType: media.container === "mp4" ? "video/mp4" : media.container === "webm" ? "video/webm" : "video/x-matroska",
  stream: { progressive: `/public/file/${seal({ ref, server: server.id, path: part.key }, ttl)}` },
 });
 for (const [target, kbps] of [[2160, 20000], [1080, 8000], [720, 4000], [480, 1500], [360, 800]] as const) {
  if (target > height) continue;
  const session = randomUUID();
  const ticket = seal({ ref, server: server.id, session, key: item.ratingKey, height: target, bitrate: kbps }, ttl);
  sources.push({ id: `transcode-${target}`, kind: "transcode", label: `${target}p`, height: target, bitrate: kbps * 1000, description: `Transcode · ${kbps / 1000} Mbps · H.264 / AAC`, stream: { dash: `/public/play/${ticket}/manifest.mpd`, session: { keepAlive: `/public/play/${ticket}/ping`, release: `/public/play/${ticket}/release`, everySeconds: 45 } } });
 }
 const compatible = media?.container === "mp4" && media.videoCodec === "h264" && ["aac", "mp3"].includes(media.audioCodec || "");
 const initial = (compatible ? sources.find((s) => s.id === "original") : undefined) ?? sources.find((s) => s.id === "transcode-1080") ?? sources.find((s) => s.kind === "transcode") ?? sources[0]!;
 return { ...initial.stream, sources, defaultSource: initial.id, subtitles };
}
export const mediaRoutes = new Hono<ServiceEnv>();
function read(token: string): Ticket {
 const data = open<Ticket>(token);
 if (!data || !data.ref || !data.server) throw fail(403, "This Plex playback link expired. Reload the page.");
 return data;
}
function startPath(ticket: Ticket): string {
 return `/video/:/transcode/universal/start.mpd?${new URLSearchParams({ path: `/library/metadata/${ticket.key}`, mediaIndex: "0", partIndex: "0", protocol: "dash", directPlay: "0", directStream: "0", videoCodec: "h264", audioCodec: "aac", maxVideoBitrate: String(ticket.bitrate ?? 8000), videoBitrate: String(ticket.bitrate ?? 8000), videoResolution: `${Math.ceil((ticket.height ?? 1080) * 16 / 9)}x${ticket.height ?? 1080}`, videoQuality: "100", subtitles: "none", session: ticket.session!, "X-Plex-Session-Identifier": ticket.session!, "X-Plex-Client-Profile-Extra": "add-transcode-target(type=videoProfile&context=streaming&protocol=dash&container=mp4&videoCodec=h264&audioCodec=aac)" })}`;
}
async function stream(server: Server, resource: string, method: string, range?: string, type?: string, signal?: AbortSignal) {
 const res = await request(server, resource, { method, headers: range ? { range } : {}, signal });
 if (![200, 206, 304, 416].includes(res.status)) throw fail(502, `Plex could not serve this media (${res.status}). Check playback permissions and transcoding on your server.`, "upstream");
 const out = new Headers({ "cache-control": "private, no-store" });
 for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) { const value = res.headers.get(key); if (value) out.set(key, value); }
 if (type) out.set("content-type", type);
 return new Response(res.body, { status: res.status, headers: out });
}
mediaRoutes.on(["GET", "HEAD"], "/file/:ticket", async (c) => {
 const ticket = read(c.req.param("ticket"));
 if (!ticket.path?.startsWith("/library/parts/")) throw fail(403, "Invalid media file.");
 return stream(await serverFor(ticket.ref, ticket.server), ticket.path, c.req.method, c.req.header("range"), undefined, c.req.raw.signal);
});
mediaRoutes.get("/subtitle/:ticket", async (c) => {
 const ticket = read(c.req.param("ticket")); if (!/^\/library\/streams\/\d+\?format=vtt$/.test(ticket.path || "")) throw fail(403, "Invalid subtitle.");
 return stream(await serverFor(ticket.ref, ticket.server), ticket.path!, "GET", undefined, "text/vtt; charset=utf-8");
});
mediaRoutes.get("/image/:ticket", async (c) => {
 const ticket = read(c.req.param("ticket")); if (!/^\/library\/(metadata|sections)\//.test(ticket.path || "")) throw fail(403, "Invalid image.");
 const res = await request(await serverFor(ticket.ref, ticket.server), ticket.path!);
 if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw fail(502, "Plex artwork is unavailable.");
 return new Response(res.body, { headers: { "content-type": res.headers.get("content-type")!, "cache-control": "private, max-age=3600" } });
});
mediaRoutes.get("/play/:ticket/manifest.mpd", async (c) => {
 const token = c.req.param("ticket"); const ticket = read(token);
 if (!ticket.session || !ticket.key) throw fail(403, "Invalid playback session.");
 const server = await serverFor(ticket.ref, ticket.server);
 const resource = startPath(ticket); const res = await request(server, resource);
 if (!res.ok) throw fail(502, `Plex could not start playback (${res.status}). Check remote-playback access and your server's transcoder.`, "upstream");
 const scope = `/video/:/transcode/universal/session/${ticket.session}/`;
 const xml = rewriteManifest(await res.text(), server.url, resource, (path) => {
  if (!new URL(path, server.url).pathname.startsWith(scope)) throw fail(502, "Plex returned media outside this playback session.");
  return `${c.get("base")}/public/media/${token}${path}`;
 });
 return c.body(xml, 200, { "content-type": "application/dash+xml", "cache-control": "private, no-store" });
});
mediaRoutes.on(["GET", "HEAD"], "/media/:ticket/*", async (c) => {
 const ticket = read(c.req.param("ticket"));
 if (!ticket.session) throw fail(403, "Invalid playback session.");
 const prefix = `/public/media/${c.req.param("ticket")}`;
 const incoming = new URL(c.req.url); const resource = incoming.pathname.slice(prefix.length) + incoming.search;
 if (!new URL(resource, "http://plex.invalid").pathname.startsWith(`/video/:/transcode/universal/session/${ticket.session}/`)) throw fail(403, "Invalid playback resource.");
 return stream(await serverFor(ticket.ref, ticket.server), resource, c.req.method, c.req.header("range"), undefined, c.req.raw.signal);
});
for (const action of ["ping", "release"]) mediaRoutes.post(`/play/:ticket/${action}`, async (c) => {
 const ticket = read(c.req.param("ticket")); if (!ticket.session) throw fail(403, "Invalid playback session.");
 const server = await serverFor(ticket.ref, ticket.server);
 const resource = action === "release" ? `/video/:/transcode/universal/stop?session=${ticket.session}` : `/video/:/transcode/universal/session/${ticket.session}/ping`;
 const res = await request(server, resource);
 if (!res.ok && res.status !== 404) throw fail(502, "Plex could not update the playback session.");
 return c.json({ ok: true });
});
