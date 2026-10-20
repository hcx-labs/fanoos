import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Subtitle } from "@tube/shared";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { SharedCache } from "../../kit/src/cache.ts";
import { seal, open } from "./crypto.ts";
import { selecting, selectionKey } from "./selection.ts";
import { request, serverFor } from "./client.ts";
import type { PlexItem, PlexPart, Server } from "./types.ts";

type Ticket = { ref: string; server: string; key: string; part: number; stream: number; external: boolean; format: "ass" | "vtt"; cache: string };
const textCodecs = new Set(["srt", "subrip", "webvtt", "ass", "ssa", "mov_text", "text"]);
const maxFile = 16 * 1024 * 1024;
const textCache = new SharedCache<string>("text-subtitles-native-v2", { ttlSeconds: 7 * 86400, staleSeconds: 0 });
const failures = new SharedCache<string>("text-subtitle-errors-native-v2", { ttlSeconds: 30, staleSeconds: 0 });

export function subtitleTracks(ref: string, server: Server, item: PlexItem, part: PlexPart): Subtitle[] {
 return (part.Stream ?? []).filter((s) => s.streamType === 3).map((s) => {
  const base = { id: String(s.id), locale: s.languageCode || "und", label: s.displayTitle || s.language || "Subtitles" };
  if (!textCodecs.has(s.codec || "")) return { ...base, format: "vtt", render: "server", url: "" };
  // Plex's subtitle-only transcoder emits ASS for embedded text, including SRT.
  const format = !s.key || ["ass", "ssa"].includes(s.codec || "") ? "ass" : "vtt";
  const cache = createHash("sha256").update(JSON.stringify([ref, server.id, item.ratingKey, part.id, part.size, item.updatedAt, s.id, format])).digest("hex");
  return { ...base, format, url: `/public/text-subtitle/${seal({ ref, server: server.id, key: String(item.ratingKey), part: Number(part.id), stream: Number(s.id), external: Boolean(s.key), format, cache } satisfies Ticket, 8 * 3600)}` };
 });
}

export function subtitleParams(key: string, stream: number, session: string): URLSearchParams {
 return new URLSearchParams({
  path: `/library/metadata/${key}`, mediaIndex: "0", partIndex: "0", hasMDE: "1",
  protocol: "http", directPlay: "1", directStream: "1", directStreamAudio: "1",
  subtitleStreamID: String(stream), subtitles: "sidecar", advancedSubtitles: "text",
  session, "X-Plex-Session-Identifier": session, "X-Plex-Session-Id": randomUUID(),
  "X-Plex-Client-Profile-Name": "Generic", offset: "0", copyts: "1", fastSeek: "1",
  mediaBufferSize: "102400", location: "lan", subtitleSize: "100", audioBoost: "100",
  videoQuality: "100", maxVideoBitrate: "100000", videoResolution: "1920x1080",
  "X-Plex-Client-Profile-Extra": "add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mkv&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3&subtitleCodec=ass,srt)+add-transcode-target(type=subtitleProfile&context=all&protocol=http&container=ass&subtitleCodec=ass)+add-settings(DirectPlayStreamSelection=true)",
 });
}

async function subtitleText(response: Response): Promise<string> {
 if (!response.ok || !response.body) throw fail(502, "Plex could not serve this subtitle track. Select it again to retry.");
 const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
 try {
  while (true) {
   const { value, done } = await reader.read(); if (done) break;
   size += value.length;
   if (size > maxFile) throw fail(502, "Plex returned an oversized subtitle track.");
   chunks.push(value);
  }
 } finally { await reader.cancel().catch(() => {}); }
 return Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
}

export async function loadSubtitle(server: Server, ticket: Pick<Ticket, "key" | "part" | "stream" | "external" | "format">): Promise<string> {
 if (ticket.external) {
  const body = await subtitleText(await request(server, `/library/streams/${ticket.stream}?encoding=utf-8&format=${ticket.format === "ass" ? "ass" : "vtt"}`));
  if (ticket.format === "ass") {
   if (!body.includes("[Events]")) throw fail(502, "Plex returned an invalid ASS subtitle.");
   return body;
  }
  if (body.startsWith("WEBVTT")) return body;
  // Some PMS versions return SRT despite format=vtt; this changes only subtitle timestamps.
  if (!/^\d{2}:\d{2}:\d{2},\d{3} --> /m.test(body)) throw fail(502, "Plex returned an invalid text subtitle.");
  return `WEBVTT\n\n${body.replace(/\r\n?/g, "\n").replace(/^(\d{2}:\d{2}:\d{2}),(\d{3})( --> \d{2}:\d{2}:\d{2}),(\d{3})/gm, "$1.$2$3.$4")}\n`;
 }
 return selecting(selectionKey(server, ticket.part), async () => {
 const session = randomBytes(12).toString("hex");
 const params = subtitleParams(ticket.key, ticket.stream, session);
 const signal = AbortSignal.timeout(90_000);
 let previous = 0, changed = false;
 const metadata = async (signal: AbortSignal) => {
  const response = await request(server, `/library/metadata/${ticket.key}`, { signal });
  if (!response.ok) throw fail(502, "Plex could not read this subtitle track. Reload the video and try again.");
  const data = await response.json() as { MediaContainer: { Metadata?: PlexItem[] } };
  return data.MediaContainer.Metadata?.[0]?.Media?.flatMap((media, mediaIndex) => (media.Part ?? []).map((part, partIndex) => ({ part, mediaIndex, partIndex }))).find(({ part }) => Number(part.id) === ticket.part);
 };
 try {
  const selectedPart = await metadata(signal);
  if (!selectedPart?.part.Stream?.some((s) => s.streamType === 3 && Number(s.id) === ticket.stream)) throw fail(502, "This subtitle track is no longer available. Reload the video.");
  params.set("mediaIndex", String(selectedPart.mediaIndex)); params.set("partIndex", String(selectedPart.partIndex));
  previous = Number(selectedPart.part.Stream.find((s) => s.streamType === 3 && s.selected)?.id ?? 0);
  if (previous !== ticket.stream) {
   // PMS ignores subtitleStreamID for unselected embedded tracks (notably SRT).
   // Select only subtitles, then restore the preference once the isolated fetch finishes.
   changed = true;
   const response = await request(server, `/library/parts/${ticket.part}?subtitleStreamID=${ticket.stream}`, { method: "PUT", signal });
   await response.body?.cancel();
   if (!response.ok) throw fail(502, "Plex could not select the requested subtitle track.");
  }
  const response = await request(server, `/video/:/transcode/universal/decision?${params}`, { signal });
  if (!response.ok) throw fail(502, "Plex could not prepare this subtitle track.");
  const { MediaContainer: decision } = await response.json() as { MediaContainer: { generalDecisionCode?: number; mdeDecisionCode?: number; transcodeDecisionCode?: number; Metadata?: PlexItem[] } };
  if ([decision.generalDecisionCode, decision.mdeDecisionCode, decision.transcodeDecisionCode].some((code) => Number(code ?? 0) >= 2000)) throw fail(502, "Plex rejected subtitle playback for this item.");
  const selected = decision.Metadata?.[0]?.Media?.flatMap((media) => media.Part ?? []).find((p) => Number(p.id) === ticket.part)?.Stream?.find((s) => s.streamType === 3 && s.selected);
  if (!selected || String(selected.id) !== String(ticket.stream)) throw fail(502, "Plex could not select the requested subtitle track.");
  const text = await subtitleText(await request(server, `/subtitles/:/transcode/universal/start?${params}`, { signal }));
  if (!text.includes("[Script Info]") || !text.includes("[Events]")) throw fail(502, "Plex returned an invalid ASS subtitle.");
  return text;
 } finally {
  // Only stop our subtitle session; never the video's playback session.
  await request(server, `/video/:/transcode/universal/stop?session=${session}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel()).catch(() => {});
  if (changed) {
   try {
    const current = await metadata(AbortSignal.timeout(5000));
    // Don't overwrite a newer selection made by a different Plex client.
    if (Number(current?.part.Stream?.find((s) => s.streamType === 3 && s.selected)?.id ?? 0) === ticket.stream) {
     const response = await request(server, `/library/parts/${ticket.part}?subtitleStreamID=${previous}`, { method: "PUT", signal: AbortSignal.timeout(5000) });
     await response.body?.cancel();
     if (!response.ok) throw Error("Plex rejected preference restoration");
    }
   } catch { console.warn("Plex subtitle playback completed, but the previous subtitle preference could not be restored."); }
  }
 }
 });
}

async function cached(ticket: Ticket): Promise<string> {
 return textCache.get(ticket.cache, async () => loadSubtitle(await serverFor(ticket.ref, ticket.server), ticket));
}
export const subtitleRoutes = new Hono<ServiceEnv>();
subtitleRoutes.get("/text-subtitle/:ticket", async (c) => {
 const ticket = open<Ticket>(c.req.param("ticket"));
 if (!ticket || !ticket.ref || !ticket.server || !/^\d+$/.test(ticket.key) || !Number.isInteger(ticket.part) || !Number.isInteger(ticket.stream) || !/^[a-f0-9]{64}$/.test(ticket.cache) || !["ass", "vtt"].includes(ticket.format) || typeof ticket.external !== "boolean") throw fail(403, "This subtitle link expired. Reload the page.");
 await serverFor(ticket.ref, ticket.server);
 const ready = (await textCache.getMany([ticket.cache])).values.get(ticket.cache);
 if (ready === undefined) {
  const error = (await failures.getMany([ticket.cache])).values.get(ticket.cache);
  if (error) { await failures.delete(ticket.cache); throw fail(502, error); }
  void cached(ticket).catch(async (error: { res?: Response }) => {
   const detail = await error.res?.json().catch(() => null) as { error?: string } | undefined;
   await failures.setMany([[ticket.cache, detail?.error || "Plex could not load this subtitle. Select it again to retry."]]);
  }).catch(() => {});
  return c.json({ pending: true }, 202, { "retry-after": "1", "cache-control": "no-store" });
 }
 return new Response(ready, { headers: { "content-type": ticket.format === "ass" ? "text/x-ssa; charset=utf-8" : "text/vtt; charset=utf-8", "cache-control": "private, max-age=3600" } });
});
