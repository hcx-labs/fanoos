/*
 * Image and video proxy. The browser never talks to Google: every thumbnail and
 * avatar is rewritten to /api/img, and every media segment to /api/media (which
 * forwards to the local streaming companion). URLs carry an HMAC signature, so
 * the proxy only fetches what this server handed out.
 */
import { Hono } from "hono";
import { config } from "./config.ts";
import { sign, verifySignature } from "./crypto.ts";
import { fail } from "./http.ts";
import { signedInReady, signedInUrl } from "./youtube/signed-in.ts";

const imageHosts = /^(i\d?\.ytimg\.com|yt\d?\.ggpht\.com|yt\d?\.googleusercontent\.com|lh\d\.googleusercontent\.com)$/;

const encode = (url: string) => Buffer.from(url).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

/** Path to fetch an image through this server. Protocol-relative URLs are accepted. */
export function proxyImage(url: string | undefined): string {
  if (!url) return "";
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  const u = encode(absolute);
  return `/api/img?u=${u}&s=${sign(`img:${u}`)}`;
}

/** Which companion a stream comes from: anonymous ("a") or signed-in ("s"). */
export type CompanionInstance = "a" | "s";

/** Absolute URL that streams a companion /videoplayback path through this server. */
export function proxyCompanion(path: string, origin: string, instance: CompanionInstance): string {
  const p = encode(path);
  return `${origin}/api/media?i=${instance}&p=${p}&s=${sign(`media:${instance}:${p}`)}`;
}

function target(kind: "img", u: string | undefined, s: string | undefined, hosts: RegExp): URL {
  if (!u || !s || !verifySignature(`${kind}:${u}`, s)) throw fail(403, "Bad signature.");
  const url = new URL(decode(u));
  if (url.protocol !== "https:" || !hosts.test(url.hostname)) throw fail(403, "Host not allowed.");
  return url;
}

export const mediaRoutes = new Hono();

mediaRoutes.get("/img", async (c) => {
  const url = target("img", c.req.query("u"), c.req.query("s"), imageHosts);
  let upstream = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  // Not every video has a 720p thumbnail; fall back to the always-present one.
  if (upstream.status === 404 && /\/(hq720|maxresdefault)\.jpg$/.test(url.pathname)) {
    upstream = await fetch(new URL(url.pathname.replace(/[^/]+\.jpg$/, "hqdefault.jpg"), url), { headers: { "user-agent": "Mozilla/5.0" } });
  }
  if (!upstream.ok || !upstream.body) throw fail(502, "Image unavailable.");
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=86400, immutable",
    },
  });
});

mediaRoutes.get("/media", async (c) => {
  const { i, p, s } = c.req.query();
  if (!p || !s || (i !== "a" && i !== "s") || !verifySignature(`media:${i}:${p}`, s)) throw fail(403, "Bad signature.");
  const path = decode(p);
  const base = i === "s" ? (signedInReady() ? signedInUrl : "") : config.companion.url;
  if (!path.startsWith("/companion/videoplayback?") || !base) throw fail(403, "Not a stream URL.");
  const url = `${base}${path}`;
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0" };
  const range = c.req.header("range");
  if (range) headers.range = range;
  const upstream = await fetch(url, { headers, signal: c.req.raw.signal });
  if (!upstream.body || upstream.status >= 400) throw fail(502, `Media unavailable (${upstream.status}).`);
  const out = new Headers({ "cache-control": "private, max-age=3600" });
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
});
