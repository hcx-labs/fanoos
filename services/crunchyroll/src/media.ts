/*
 * Image proxy: artwork and thumbnails load through this backend (signed URLs, Crunchyroll hosts only).
 */
import { Hono } from "hono";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { send } from "./client.ts";
import { sign, verify } from "./crypto.ts";

const imageHosts = /(^|\.)crunchyroll\.com$/;
const encode = (url: string) => Buffer.from(url).toString("base64url");

export function proxyImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const u = encode(url);
  return `/public/img?u=${u}&s=${sign(`img:${u}`)}`;
}

export const mediaRoutes = new Hono<ServiceEnv>();

mediaRoutes.get("/img", async (c) => {
  const { u, s } = c.req.query();
  if (!u || !s || !verify(`img:${u}`, s)) throw fail(403, "Bad signature.");
  const url = new URL(Buffer.from(u, "base64url").toString("utf8"));
  if (url.protocol !== "https:" || !imageHosts.test(url.hostname)) throw fail(403, "Host not allowed.");
  const upstream = await send(url.toString(), { timeoutMs: 15_000 });
  if (upstream.status !== 200) throw fail(502, "Image unavailable.");
  return c.body(new Uint8Array(upstream.body), 200, {
    "content-type": String(upstream.headers["content-type"] ?? "image/jpeg"),
    "cache-control": "private, max-age=86400, immutable",
  });
});
