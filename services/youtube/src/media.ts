/*
 * Image and video proxy. The browser never talks to Google: every thumbnail and
 * avatar is rewritten to /public/img, and every media segment to /public/media (which
 * forwards to the local streaming companion). URLs carry an HMAC signature, so
 * the proxy only fetches what this backend handed out.
 */
import { Hono } from "hono";
import { config } from "./config.ts";
import { sign, verifySignature } from "./crypto.ts";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { signedInReady, signedInUrl } from "./signed-in.ts";
import { thumbnailFallbacks } from "./image-fallbacks.ts";
import { companionCaptionPath, fetchCaptionVtt, validCaptionSelection, type CaptionSelection } from "./captions.ts";

const imageHosts = /^(i\d?\.ytimg\.com|yt\d?\.ggpht\.com|yt\d?\.googleusercontent\.com|lh\d\.googleusercontent\.com)$/;

const encode = (url: string) => Buffer.from(url).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

/** Path to fetch an image through this server. Protocol-relative URLs are accepted. */
export function proxyImage(url: string | undefined): string {
  if (!url) return "";
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  const u = encode(absolute);
  return `/public/img?u=${u}&s=${sign(`img:${u}`)}`;
}

/** Which companion a stream comes from: anonymous ("a") or signed-in ("s"). */
export type CompanionInstance = "a" | "s";

/** URL (under the browser-facing base) that streams a companion /videoplayback path through this backend. */
export function proxyCompanion(path: string, base: string, instance: CompanionInstance): string {
  const p = encode(path);
  return `${base}/public/media?i=${instance}&p=${p}&s=${sign(`media:${instance}:${p}`)}`;
}

function target(kind: "img", u: string | undefined, s: string | undefined, hosts: RegExp): URL {
  if (!u || !s || !verifySignature(`${kind}:${u}`, s)) throw fail(403, "Bad signature.");
  const url = new URL(decode(u));
  if (url.protocol !== "https:" || !hosts.test(url.hostname)) throw fail(403, "Host not allowed.");
  return url;
}

export function proxyCaption(video: string, label: string, instance: CompanionInstance): string {
  const selection: CaptionSelection = { video, label, instance, expires: Date.now() + 6 * 3600_000 };
  const p = encode(JSON.stringify(selection));
  return `/public/captions?p=${p}&s=${sign(`captions:${p}`)}`;
}

export function captionTarget(p: string | undefined, s: string | undefined): CaptionSelection {
  if (!p || p.length > 8192 || !s || !verifySignature(`captions:${p}`, s)) throw fail(403, "Bad signature.");
  let value: unknown;
  try { value = JSON.parse(decode(p)); } catch { throw fail(403, "Invalid caption selector."); }
  if (!validCaptionSelection(value)) throw fail(403, "Invalid or expired caption selector.");
  return value;
}

export const mediaRoutes = new Hono<ServiceEnv>();

mediaRoutes.get("/captions", async (c) => {
  const selection = captionTarget(c.req.query("p"), c.req.query("s"));
  const base = selection.instance === "s" ? (signedInReady() ? signedInUrl : "") : config.companion.url;
  if (!base) throw fail(403, "Caption instance unavailable.");
  try {
    const text = await fetchCaptionVtt(`${base}${companionCaptionPath(selection, config.companion.secret)}`, c.req.raw.signal,
      { authorization: `Bearer ${config.companion.secret}` });
    return c.body(text, 200, { "content-type": "text/vtt; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  } catch { throw fail(502, "Captions unavailable."); }
});

mediaRoutes.get("/img", async (c) => {
  const url = target("img", c.req.query("u"), c.req.query("s"), imageHosts);
  const get = (u: URL) => fetch(u, { headers: { "user-agent": "Mozilla/5.0" }, signal: c.req.raw.signal });
  let upstream = await get(url);
  // A missing 16:9 thumbnail (some videos, or some addresses for age-restricted ones): try the
  // other full-size name, then 640×480, and only then the always-present 480×360 one.
  let fallback = false;
  if (upstream.status === 404) {
    for (const next of thumbnailFallbacks(url)) {
      await upstream.body?.cancel();
      upstream = await get(next);
      fallback = true;
      // Don't turn a rate limit or server failure into requests for every image size.
      if (upstream.status !== 404) break;
    }
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    throw fail(502, "Image unavailable.");
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      // A stand-in is cached briefly, so the full image shows up once it's served again.
      "cache-control": fallback ? "private, max-age=3600" : "private, max-age=86400, immutable",
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
