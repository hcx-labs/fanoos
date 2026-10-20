import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { PlaybackSource, Stream } from "@tube/shared";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { seal, open } from "./crypto.ts";
import { request, serverFor } from "./client.ts";
import { subtitleTracks, subtitleRoutes } from "./subtitles.ts";
import { rewriteManifest } from "./manifest.ts";
import type { PlexItem, Server } from "./types.ts";
type Ticket = { ref: string; server: string; path?: string; session?: string; key?: string; height?: number; bitrate?: number; audio?: number; part?: number; subtitles?: number[]; subtitle?: number; copyVideo?: boolean; audioCodec?: string };
import { SharedCache } from "../../kit/src/cache.ts";
const artwork = new SharedCache<{ type: string; body: string }>("artwork", { ttlSeconds: 86400, staleSeconds: 86400 });
const ttl = 8 * 3600;
// Plex stores stream selection per account/part. Keep selection and session creation together.
const selections = new Map<string, Promise<void>>();
async function selecting<T>(key: string, run: () => Promise<T>): Promise<T> {
 const previous = selections.get(key) ?? Promise.resolve();
 let release!: () => void;
 const gate = new Promise<void>((resolve) => { release = resolve; });
 const pending = previous.then(() => gate);
 selections.set(key, pending);
 await previous;
 try { return await run(); } finally { release(); if (selections.get(key) === pending) selections.delete(key); }
}
export function playback(ref: string, server: Server, item: PlexItem, audio?: number): Stream {
 const media = item.Media?.[0]; const part = media?.Part?.[0];
 if (!part) return { unavailable: { code: "unplayable", reason: "Plex could not find a playable media file." } };
 const subtitles = subtitleTracks(ref, server, item, part);
 const height = media?.videoResolution === "4k" ? 2160 : Number(media?.videoResolution) || media?.height || 1080;
 const sources: PlaybackSource[] = [];
 const selectedAudio = (part.Stream ?? []).find((s) => s.streamType === 2 && s.selected) ?? (part.Stream ?? []).find((s) => s.streamType === 2);
 const originalCodec = selectedAudio?.codec || media?.audioCodec || "unknown";
 if (audio === undefined && media?.Part?.length === 1) sources.push({
  id: "original", kind: "original", label: `Original · ${height}p`, height, bitrate: (media.bitrate ?? 0) * 1000,
  description: `Direct play · ${[media.container?.toUpperCase(), media.videoCodec?.toUpperCase(), originalCodec.toUpperCase()].filter(Boolean).join(" · ")}`,
  stream: { progressive: `/public/file/${seal({ ref, server: server.id, path: part.key }, ttl)}` },
 });
 if (audio !== undefined) {
  const session = randomUUID();
  const ticket = seal({ ref, server: server.id, session, key: item.ratingKey, height, bitrate: Math.max(media?.bitrate ?? 0, 100000), audio, part: part.id, subtitles: subtitles.filter((s) => s.render === "server").map((s) => Number(s.id)), copyVideo: true }, ttl);
  sources.push({ id: "transcode-auto", kind: "transcode", label: "Auto", description: "AAC stereo · Plex decides whether to convert video", stream: { dash: `/public/play/${ticket}/manifest.mpd`, session: { keepAlive: `/public/play/${ticket}/ping`, release: `/public/play/${ticket}/release`, everySeconds: 45 } } });
 }
 for (const [target, kbps] of [[2160, 20000], [1080, 8000], [720, 4000], [480, 1500], [360, 800]] as const) {
  if (target > height) continue;
  const session = randomUUID();
  const ticket = seal({ ref, server: server.id, session, key: item.ratingKey, height: target, bitrate: kbps, audio, part: part.id, audioCodec: audio === undefined ? originalCodec : undefined, subtitles: subtitles.filter((s) => s.render === "server").map((s) => Number(s.id)) }, ttl);
  sources.push({ id: `transcode-${target}`, kind: "transcode", label: `${target}p`, height: target, bitrate: kbps * 1000, description: `Transcode · ${kbps / 1000} Mbps · H.264 / ${audio !== undefined ? "AAC stereo" : originalCodec.toUpperCase()}`, stream: { dash: `/public/play/${ticket}/manifest.mpd`, session: { keepAlive: `/public/play/${ticket}/ping`, release: `/public/play/${ticket}/release`, everySeconds: 45 } } });
 }
 const initial = sources.find((s) => s.id === "original") ?? sources.find((s) => s.id === "transcode-auto") ?? sources.find((s) => s.id === "transcode-1080") ?? sources.find((s) => s.kind === "transcode") ?? sources[0]!;
 const audioChoices = (part.Stream ?? []).filter((s) => s.streamType === 2);
 if (!audioChoices.length) audioChoices.push({ id: 0, streamType: 2, codec: originalCodec, displayTitle: originalCodec.toUpperCase(), selected: true });
 const audioTracks = audio === undefined ? audioChoices.map((s) => ({ id: String(s.id), locale: s.languageCode || "und", label: s.displayTitle || s.language || "Original", selected: Boolean(s.selected), sources: playback(ref, server, item, s.id).sources! })) : undefined;
 return { ...initial.stream, sources, defaultSource: initial.id, subtitles, audioTracks, originalAudio: { label: selectedAudio?.displayTitle || selectedAudio?.language || originalCodec.toUpperCase(), codec: originalCodec, mimeType: ({ eac3: 'audio/mp4; codecs="ec-3"', ac3: 'audio/mp4; codecs="ac-3"', aac: 'audio/mp4; codecs="mp4a.40.2"', mp3: "audio/mpeg", opus: 'audio/webm; codecs="opus"' } as Record<string, string>)[originalCodec] } };
}
export const mediaRoutes = new Hono<ServiceEnv>();
mediaRoutes.route("/", subtitleRoutes);
function read(token: string): Ticket {
 const data = open<Ticket>(token);
 if (!data || !data.ref || !data.server) throw fail(403, "This Plex playback link expired. Reload the page.");
 return data;
}
function startPath(ticket: Ticket): string {
 return `/video/:/transcode/universal/start.mpd?${new URLSearchParams({ path: `/library/metadata/${ticket.key}`, mediaIndex: "0", partIndex: "0", protocol: "dash", directPlay: "0", directStream: ticket.copyVideo && ticket.subtitle === undefined ? "1" : "0", directStreamAudio: ticket.audioCodec ? "1" : "0", ...(!ticket.audioCodec ? { audioChannelCount: "2" } : {}), videoCodec: "h264", audioCodec: ticket.audioCodec || "aac", maxVideoBitrate: String(ticket.bitrate ?? 8000), videoBitrate: String(ticket.bitrate ?? 8000), videoResolution: `${Math.ceil((ticket.height ?? 1080) * 16 / 9)}x${ticket.height ?? 1080}`, videoQuality: "100", subtitles: ticket.subtitle !== undefined ? "burn" : "none", ...(ticket.audio ? { audioStreamID: String(ticket.audio) } : {}), session: ticket.session!, "X-Plex-Session-Identifier": ticket.session!, "X-Plex-Client-Profile-Extra": `add-transcode-target(type=videoProfile&context=streaming&protocol=dash&container=mp4&videoCodec=h264&audioCodec=${ticket.audioCodec || "aac"})` })}`;
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
 const server = await serverFor(ticket.ref, ticket.server);
 const key = createHash("sha256").update(JSON.stringify([ticket.ref, server.id, server.token, ticket.path])).digest("hex");
 const image = await artwork.get(key, async () => {
  const res = await request(server, ticket.path!);
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw fail(502, "Plex artwork is unavailable.");
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > 16 * 1024 * 1024) throw fail(502, "Plex artwork is too large.");
  return { type: res.headers.get("content-type")!, body: body.toString("base64") };
 });
 return new Response(Buffer.from(image.body, "base64"), { headers: { "content-type": image.type, "cache-control": "private, max-age=86400" } });
});
mediaRoutes.get("/play/:ticket/manifest.mpd", async (c) => {
 let token = c.req.param("ticket"); const ticket = read(token);
 if (!ticket.session || !ticket.key) throw fail(403, "Invalid playback session.");
 const server = await serverFor(ticket.ref, ticket.server);
 const subtitle = c.req.query("subtitle");
 if (subtitle !== undefined) {
  if (!/^\d+$/.test(subtitle) || !ticket.subtitles?.includes(Number(subtitle))) throw fail(403, "Invalid subtitle selection.");
  ticket.subtitle = Number(subtitle);
  ticket.session += `-s${subtitle}`;
  token = seal(ticket, ttl);
 }
 const resource = startPath(ticket);
 const res = await selecting(`${ticket.ref}:${ticket.server}:${ticket.part}`, async () => {
 if (ticket.part && (Boolean(ticket.audio) || ticket.subtitle !== undefined)) {
  const selection = new URLSearchParams({ ...(ticket.audio ? { audioStreamID: String(ticket.audio) } : {}), ...(ticket.subtitle !== undefined ? { subtitleStreamID: String(ticket.subtitle) } : {}) });
  const selected = await request(server, `/library/parts/${ticket.part}?${selection}`, { method: "PUT" });
  if (!selected.ok) throw fail(502, "Plex could not select this audio or subtitle track.");
 }
 return request(server, resource);
 });
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
 const subtitle = c.req.query("subtitle");
 if (subtitle !== undefined) {
  if (!/^\d+$/.test(subtitle) || !ticket.subtitles?.includes(Number(subtitle))) throw fail(403, "Invalid subtitle selection.");
  ticket.session += `-s${subtitle}`;
 }
 const server = await serverFor(ticket.ref, ticket.server);
 const resource = action === "release" ? `/video/:/transcode/universal/stop?session=${ticket.session}` : `/video/:/transcode/universal/session/${ticket.session}/ping`;
 const res = await request(server, resource);
 if (!res.ok && res.status !== 404) throw fail(502, "Plex could not update the playback session.");
 return c.json({ ok: true });
});
