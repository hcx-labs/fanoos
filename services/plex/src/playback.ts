import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { DownloadPlan, PlaybackSource, Stream } from "@tube/shared";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { seal, open } from "./crypto.ts";
import { request, serverFor } from "./client.ts";
import { selecting, selectionKey } from "./selection.ts";
import { subtitleTracks, subtitleRoutes } from "./subtitles.ts";
import { rewriteManifest } from "./manifest.ts";
import type { PlexItem, Server } from "./types.ts";
type Ticket = { ref: string; server: string; path?: string; session?: string; key?: string; height?: number; bitrate?: number; audio?: number; part?: number; subtitles?: number[]; subtitle?: number; copyVideo?: boolean; audioCodec?: string; nativeVideoCodec?: string; requireCopy?: boolean };
import { SharedCache } from "../../kit/src/cache.ts";
const artwork = new SharedCache<{ type: string; body: string }>("artwork", { ttlSeconds: 86400, staleSeconds: 86400 });
const ttl = 8 * 3600;
const audioMime = (codec: string) => ({ eac3: 'audio/mp4; codecs="ec-3"', ac3: 'audio/mp4; codecs="ac-3"', aac: 'audio/mp4; codecs="mp4a.40.2"', mp3: "audio/mpeg", opus: 'audio/webm; codecs="opus"' } as Record<string, string>)[codec];
const containerMime = (container: string) => ({ mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", mkv: "video/x-matroska", webm: "video/webm" } as Record<string, string>)[container];
const heightOf = (media: NonNullable<PlexItem["Media"]>[number] | undefined) => media?.videoResolution === "4k" ? 2160 : Number(media?.videoResolution) || media?.height || 1080;
/** The original file for desktop downloads: saved byte-for-byte and played like direct play. */
export function downloadPlan(ref: string, server: Server, item: PlexItem): DownloadPlan {
 const media = item.Media?.[0]; const part = media?.Part?.[0];
 if (!part) throw fail(404, "Plex could not find a media file for this item.", "not_found");
 if (media.Part!.length > 1) throw fail(400, "This item is split across several files, which can't be downloaded yet.");
 if (!part.size) throw fail(400, "Plex didn't report this file's size, so it can't be downloaded.");
 const container = (part.container || media.container || "").toLowerCase();
 const mimeType = containerMime(container);
 if (!mimeType) throw fail(400, `${container.toUpperCase() || "This"} files can't be played offline. Fanoos downloads MP4, MKV and WebM files.`);
 const audio = (part.Stream ?? []).find((s) => s.streamType === 2 && s.default) ?? (part.Stream ?? []).find((s) => s.streamType === 2);
 const height = heightOf(media);
 return {
  duration: (item.duration ?? 0) / 1000,
  tracks: [],
  files: [{ id: `part-${part.id}`, label: `Original · ${height}p`, mimeType, container, videoCodec: media.videoCodec, audioCodec: audio?.codec || media.audioCodec, audio: audio?.displayTitle || audio?.language, height, bytes: part.size, url: `/public/file/${seal({ ref, server: server.id, path: part.key }, ttl)}` }],
  conversions: conversions(ref, server, item, height),
  // Image subtitles are burned in by the transcoder, which a saved original never passes through.
  subtitles: subtitleTracks(ref, server, item, part).filter((s) => s.render !== "server"),
 };
}
/** Every audio track at every quality, as the transcoder's DASH output: the same sessions playback uses. */
function conversions(ref: string, server: Server, item: PlexItem, height: number): NonNullable<DownloadPlan["conversions"]> {
 const media = item.Media![0]!; const part = media.Part![0]!;
 const streams = (part.Stream ?? []).filter((s) => s.streamType === 2);
 const fallback = streams.find((s) => s.default) ?? streams[0];
 return streams.flatMap((s) => {
  const audio = { id: String(s.id), label: s.displayTitle || s.language || "Audio", locale: s.languageTag || s.languageCode || "und", default: s === fallback };
  return (playback(ref, server, item, s.id).sources ?? []).filter((source) => source.stream.dash).map((source) => {
   const copy = source.id === "transcode-auto";
   return {
    id: `${s.id}:${source.id}`, audio,
    quality: { id: source.id, label: copy ? `Original · ${height}p` : source.label, height: source.height, copy },
    // Original video keeps the file's bitrate; conversions target theirs. AAC stereo adds about 160 kbps.
    bitrate: (copy ? (media.bitrate ?? 8000) * 1000 : source.bitrate ?? 8_000_000) + 160_000,
    manifest: source.stream.dash!, release: source.stream.session?.release,
   };
  });
 });
}
export function playback(ref: string, server: Server, item: PlexItem, audio?: number, copyAudio = false): Stream {
 const media = item.Media?.[0]; const part = media?.Part?.[0];
 if (!part) return { unavailable: { code: "unplayable", reason: "Plex could not find a playable media file." } };
 const subtitles = subtitleTracks(ref, server, item, part);
 const height = heightOf(media);
 const sources: PlaybackSource[] = [];
 // Progressive playback follows the file default, not Plex account track preferences.
 const selectedAudio = (part.Stream ?? []).find((s) => s.streamType === 2 && s.default) ?? (part.Stream ?? []).find((s) => s.streamType === 2);
 const originalCodec = selectedAudio?.codec || media?.audioCodec || "unknown";
 const chosenCodec = (part.Stream ?? []).find((s) => s.streamType === 2 && s.id === audio)?.codec || originalCodec;
 if (audio === undefined && media?.Part?.length === 1) sources.push({
  id: "original", kind: "original", label: `Original · ${height}p`, height, bitrate: (media.bitrate ?? 0) * 1000,
  description: `Direct play · ${[media.container?.toUpperCase(), media.videoCodec?.toUpperCase(), originalCodec.toUpperCase()].filter(Boolean).join(" · ")}`,
  stream: { progressive: `/public/file/${seal({ ref, server: server.id, path: part.key }, ttl)}` },
 });
 if (audio !== undefined) {
  const session = randomUUID();
  const ticket = seal({ ref, server: server.id, session, key: item.ratingKey, height, bitrate: Math.max(media?.bitrate ?? 0, 100000), audio, part: part.id, subtitles: subtitles.filter((s) => s.render === "server").map((s) => Number(s.id)), copyVideo: true, ...(copyAudio ? { audioCodec: chosenCodec, nativeVideoCodec: media.videoCodec || "h264", requireCopy: true } : {}) }, ttl);
  sources.push({ id: copyAudio ? "original" : "transcode-auto", kind: copyAudio ? "original" : "transcode", label: copyAudio ? `Original · ${height}p` : "Auto", height, description: copyAudio ? `Direct stream · Original ${media.videoCodec?.toUpperCase()} video / ${chosenCodec.toUpperCase()} audio` : "AAC stereo · Plex decides whether to convert video", stream: { dash: `/public/play/${ticket}/manifest.mpd`, session: { keepAlive: `/public/play/${ticket}/ping`, release: `/public/play/${ticket}/release`, everySeconds: 45 } } });
 }
 for (const [target, kbps] of [[2160, 20000], [1080, 8000], [720, 4000], [480, 1500], [360, 800]] as const) {
  if (target > height) continue;
  const session = randomUUID();
  const ticket = seal({ ref, server: server.id, session, key: item.ratingKey, height: target, bitrate: kbps, audio, part: part.id, audioCodec: audio === undefined ? originalCodec : copyAudio ? chosenCodec : undefined, subtitles: subtitles.filter((s) => s.render === "server").map((s) => Number(s.id)) }, ttl);
  sources.push({ id: `transcode-${target}`, kind: "transcode", label: `${target}p`, height: target, bitrate: kbps * 1000, description: `Transcode · ${kbps / 1000} Mbps · H.264 / ${audio !== undefined && !copyAudio ? "AAC stereo" : chosenCodec.toUpperCase()}`, stream: { dash: `/public/play/${ticket}/manifest.mpd`, session: { keepAlive: `/public/play/${ticket}/ping`, release: `/public/play/${ticket}/release`, everySeconds: 45 } } });
 }
 const initial = sources.find((s) => s.id === "original") ?? sources.find((s) => s.id === "transcode-auto") ?? sources.find((s) => s.id === "transcode-1080") ?? sources.find((s) => s.kind === "transcode") ?? sources[0]!;
 const audioChoices = (part.Stream ?? []).filter((s) => s.streamType === 2);
 if (!audioChoices.length) audioChoices.push({ id: 0, streamType: 2, codec: originalCodec, displayTitle: originalCodec.toUpperCase(), selected: true });
 const audioTracks: Stream["audioTracks"] = audio === undefined ? [
  ...audioChoices.filter((s) => s.id > 0 && s.id !== selectedAudio?.id).map((s) => ({ id: `original-${s.id}`, mode: "original" as const, locale: s.languageCode || "und", label: s.displayTitle || s.language || "Original", codec: s.codec || originalCodec, mimeType: audioMime(s.codec || originalCodec), sources: playback(ref, server, item, s.id, true).sources! })),
  ...audioChoices.map((s) => ({ id: String(s.id), mode: "transcode" as const, locale: s.languageCode || "und", label: s.displayTitle || s.language || "Original", selected: Boolean(s.selected), sources: playback(ref, server, item, s.id).sources! })),
 ] : undefined;
 return { ...initial.stream, sources, defaultSource: initial.id, subtitles, audioTracks, originalAudio: { label: selectedAudio?.displayTitle || selectedAudio?.language || originalCodec.toUpperCase(), codec: originalCodec, mimeType: audioMime(originalCodec) } };
}
export const mediaRoutes = new Hono<ServiceEnv>();
mediaRoutes.route("/", subtitleRoutes);
function read(token: string): Ticket {
 const data = open<Ticket>(token);
 if (!data || !data.ref || !data.server) throw fail(403, "This Plex playback link expired. Reload the page.");
 return data;
}
function startPath(ticket: Ticket): string {
 const videoCodec = ticket.nativeVideoCodec || "h264";
 const videoCodecs = [...new Set([videoCodec, "h264"])].join(",");
 const profile = ticket.requireCopy ? `add-transcode-target(type=videoProfile&context=streaming&protocol=dash&container=mp4&videoCodec=${videoCodecs}&audioCodec=${ticket.audioCodec})+add-direct-play-profile(type=videoProfile&container=mkv,mp4&videoCodec=${videoCodecs}&audioCodec=${ticket.audioCodec})` : `add-transcode-target(type=videoProfile&context=streaming&protocol=dash&container=mp4&videoCodec=h264&audioCodec=${ticket.audioCodec || "aac"})`;
 return `/video/:/transcode/universal/start.mpd?${new URLSearchParams({ path: `/library/metadata/${ticket.key}`, mediaIndex: "0", partIndex: "0", protocol: "dash", directPlay: "0", directStream: ticket.copyVideo && ticket.subtitle === undefined ? "1" : "0", directStreamAudio: ticket.audioCodec ? "1" : "0", ...(!ticket.audioCodec ? { audioChannelCount: "2" } : {}), videoCodec, audioCodec: ticket.audioCodec || "aac", maxVideoBitrate: String(ticket.bitrate ?? 8000), videoBitrate: String(ticket.bitrate ?? 8000), videoResolution: `${Math.ceil((ticket.height ?? 1080) * 16 / 9)}x${ticket.height ?? 1080}`, videoQuality: "100", subtitles: ticket.subtitle !== undefined ? "burn" : "none", ...(ticket.audio ? { audioStreamID: String(ticket.audio) } : {}), session: ticket.session!, "X-Plex-Session-Identifier": ticket.session!, ...(ticket.requireCopy ? { "X-Plex-Client-Profile-Name": "Generic" } : {}), "X-Plex-Client-Profile-Extra": profile })}`;
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
 const res = await selecting(selectionKey(server, ticket.part), async () => {
  const currentAudio = async () => {
   const response = await request(server, `/library/metadata/${ticket.key}`, { signal: AbortSignal.timeout(10_000) });
   if (!response.ok) throw fail(502, "Plex could not read the current audio selection.");
   const data = await response.json() as { MediaContainer: { Metadata?: PlexItem[] } };
   const tracks = data.MediaContainer.Metadata?.[0]?.Media?.flatMap((media) => media.Part ?? []).find((part) => Number(part.id) === Number(ticket.part))?.Stream?.filter((s) => s.streamType === 2) ?? [];
   return Number(tracks.find((s) => s.selected)?.id ?? tracks[0]?.id ?? 0);
  };
  const previousAudio = ticket.requireCopy ? await currentAudio() : undefined;
  let changedAudio = false;
  try {
   if (ticket.part && (Boolean(ticket.audio) || ticket.subtitle !== undefined)) {
    const selection = new URLSearchParams({ ...(ticket.audio ? { audioStreamID: String(ticket.audio) } : {}), ...(ticket.subtitle !== undefined ? { subtitleStreamID: String(ticket.subtitle) } : {}) });
    changedAudio = ticket.requireCopy === true && previousAudio !== ticket.audio;
    const selected = await request(server, `/library/parts/${ticket.part}?${selection}`, { method: "PUT" });
    await selected.body?.cancel();
    if (!selected.ok) throw fail(502, "Plex could not select this audio or subtitle track.");
   }
   if (ticket.requireCopy) {
    const response = await request(server, resource.replace("/start.mpd?", "/decision?"));
    if (!response.ok) throw fail(502, "Plex could not prepare original audio playback. Choose Transcode in Audio to retry.");
    const data = await response.json() as { MediaContainer: { Metadata?: PlexItem[] } };
    const streams = data.MediaContainer.Metadata?.[0]?.Media?.flatMap((media) => media.Part ?? []).find((part) => Number(part.id) === Number(ticket.part))?.Stream ?? [];
    const video = streams.find((s) => s.streamType === 1), audio = streams.find((s) => s.streamType === 2 && s.selected);
    if (video?.decision !== "copy" || audio?.decision !== "copy" || Number(audio.id) !== ticket.audio) throw fail(502, "Plex cannot preserve the original video and audio for this track. Choose Transcode in Audio to allow conversion.");
   }
   const response = await request(server, resource);
   // Finish creating the session before restoring preferences; subsequent segments use it.
   return ticket.requireCopy ? new Response(await response.text(), { status: response.status }) : response;
  } catch (error) {
   if (ticket.requireCopy) await request(server, `/video/:/transcode/universal/stop?session=${ticket.session}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel()).catch(() => {});
   throw error;
  } finally {
   if (changedAudio) {
    try {
     if (await currentAudio() === ticket.audio) {
      const restored = await request(server, `/library/parts/${ticket.part}?audioStreamID=${previousAudio}`, { method: "PUT", signal: AbortSignal.timeout(5000) });
      await restored.body?.cancel();
      if (!restored.ok) throw Error("Plex rejected preference restoration");
     }
    } catch { console.warn("The previous Plex audio preference could not be restored after the playback request."); }
   }
  }
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
