import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Hono } from "hono";
import type { Subtitle } from "@tube/shared";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { SharedCache } from "../../kit/src/cache.ts";
import { seal, open } from "./crypto.ts";
import { request, serverFor } from "./client.ts";
import type { PlexItem, PlexPart, Server } from "./types.ts";

type Format = "ass" | "webvtt";
type Ticket = { ref: string; server: string; path: string; map: string; format: Format; cache: string };
const textCodecs = new Set(["srt", "subrip", "webvtt", "ass", "ssa", "mov_text", "text"]);
const maxFile = 16 * 1024 * 1024;
const textCache = new SharedCache<string>("text-subtitles-v1", { ttlSeconds: 7 * 86400, staleSeconds: 0 });
const failures = new SharedCache<string>("text-subtitle-errors-v1", { ttlSeconds: 30, staleSeconds: 0 });

export function subtitleTracks(ref: string, server: Server, item: PlexItem, part: PlexPart): Subtitle[] {
 const embedded = (part.Stream ?? []).filter((s) => s.streamType === 3 && !s.key);
 return (part.Stream ?? []).filter((s) => s.streamType === 3).map((s) => {
  const base = { id: String(s.id), locale: s.languageCode || "und", label: s.displayTitle || s.language || "Subtitles" };
  if (!textCodecs.has(s.codec || "")) return { ...base, format: "vtt", render: "server", url: "" };
  const format: Format = ["ass", "ssa"].includes(s.codec || "") ? "ass" : "webvtt";
  const path = s.key ? `/library/streams/${s.id}` : part.key;
  const map = s.key ? "0:0" : s.index !== undefined && s.index >= 0 ? `0:${s.index}` : `0:s:${embedded.indexOf(s)}`;
  const cache = createHash("sha256").update(JSON.stringify([ref, server.id, path, part.size, item.updatedAt, s.id, map, format])).digest("hex");
  return { ...base, format: format === "ass" ? "ass" : "vtt", url: `/public/text-subtitle/${seal({ ref, server: server.id, path, map, format, cache }, 8 * 3600)}` };
 });
}

/** Only subtitles are written; video/audio are never re-encoded or saved. */
export async function extractSubtitle(load: (method: string, range: string | undefined, signal: AbortSignal) => Promise<Response>, map: string, format: Format): Promise<Buffer> {
 if (!/^0:(s:)?\d+$/.test(map)) throw fail(403, "Invalid subtitle track.");
 const abort = new AbortController();
 const route = `/${randomUUID()}`;
 // FFmpeg can seek using Range requests without receiving Plex credentials or private URLs.
 const bridge = createServer(async (req, res) => {
  if (req.url !== route || !["GET", "HEAD"].includes(req.method || "")) { res.writeHead(404).end(); return; }
  const upstream = new AbortController();
  const stop = () => upstream.abort();
  abort.signal.addEventListener("abort", stop, { once: true });
  res.once("close", stop);
  try {
   const response = await load(req.method!, req.headers.range, upstream.signal);
   if (![200, 206, 416].includes(response.status)) { res.writeHead(502).end(); return; }
   const headers: Record<string, string> = {};
   for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) { const value = response.headers.get(key); if (value) headers[key] = value; }
   res.writeHead(response.status, headers);
   if (response.body && req.method !== "HEAD") await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), res);
   else res.end();
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  finally { abort.signal.removeEventListener("abort", stop); }
 });
 await new Promise<void>((resolve, reject) => { bridge.once("error", reject); bridge.listen(0, "127.0.0.1", resolve); });
 try {
  const address = bridge.address();
  if (!address || typeof address === "string") throw fail(502, "Subtitle extraction could not start.");
  return await new Promise<Buffer>((resolve, reject) => {
   const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-rw_timeout", "15000000", "-i", `http://127.0.0.1:${address.port}${route}`, "-map", map, "-vn", "-an", "-dn", "-c:s", format === "ass" ? "ass" : "webvtt", "-f", format, "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
   const chunks: Buffer[] = []; let size = 0; let timedOut = false;
   const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); abort.abort(); }, 600_000);
   child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxFile) child.kill("SIGKILL"); else chunks.push(chunk); });
   child.once("error", () => { clearTimeout(timer); reject(fail(503, "Subtitle extraction needs FFmpeg on the Plex backend. Set FFMPEG_PATH if it is not on PATH.")); });
   child.once("close", (code) => {
    clearTimeout(timer);
    if (code !== 0 || size > maxFile) { reject(fail(502, timedOut ? "Subtitle extraction took too long. Select the track again to retry." : "This subtitle track could not be extracted. Select it again to retry.")); return; }
    const output = Buffer.concat(chunks);
    const text = output.toString("utf8");
    if (!(format === "ass" ? text.includes("[Events]") : text.startsWith("WEBVTT"))) { reject(fail(502, "Plex returned an invalid subtitle track.")); return; }
    resolve(output);
   });
  });
 } finally { abort.abort(); bridge.closeAllConnections(); await new Promise<void>((resolve) => bridge.close(() => resolve())); }
}

async function cached(ticket: Ticket): Promise<Buffer> {
 const text = await textCache.get(ticket.cache, async () => {
  const server = await serverFor(ticket.ref, ticket.server);
  const result = await extractSubtitle((method, range, signal) => request(server, ticket.path, { method, headers: range ? { range } : {}, signal }), ticket.map, ticket.format);
  return result.toString("utf8");
 });
 return Buffer.from(text, "utf8");
}
export const subtitleRoutes = new Hono<ServiceEnv>();
subtitleRoutes.get("/text-subtitle/:ticket", async (c) => {
 const ticket = open<Ticket>(c.req.param("ticket"));
 if (!ticket || !ticket.ref || !ticket.server || !/^[a-f0-9]{64}$/.test(ticket.cache) || !["ass", "webvtt"].includes(ticket.format) || !/^0:(s:)?\d+$/.test(ticket.map) || !/^\/library\/(parts\/\d+\/|streams\/\d+$)/.test(ticket.path)) throw fail(403, "This subtitle link expired. Reload the page.");
 await serverFor(ticket.ref, ticket.server);
 const ready = (await textCache.getMany([ticket.cache])).values.get(ticket.cache);
 if (ready === undefined) {
  const error = (await failures.getMany([ticket.cache])).values.get(ticket.cache);
  if (error) { await failures.delete(ticket.cache); throw fail(502, error); }
  // SharedCache de-duplicates the background extraction; polling never holds a proxy open.
  void cached(ticket).catch(async (error: { res?: Response }) => {
   const detail = await error.res?.json().catch(() => null) as { error?: string } | undefined;
   await failures.setMany([[ticket.cache, detail?.error || "This subtitle track could not be extracted. Select it again to retry."]]);
  }).catch(() => {});
  return c.json({ pending: true }, 202, { "retry-after": "2", "cache-control": "no-store" });
 }
 return new Response(ready, { headers: { "content-type": ticket.format === "ass" ? "text/x-ssa; charset=utf-8" : "text/vtt; charset=utf-8", "cache-control": "private, max-age=3600" } });
});
