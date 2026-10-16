/*
 * DRM playback. Crunchyroll video is Widevine-encrypted end to end: this backend never sees a
 * key. It asks Crunchyroll for a playback session as the linked account, serves the manifest
 * with segment URLs pointing back here, and forwards the browser CDM's licence requests with
 * the account's session attached. The browser's own CDM decrypts.
 *
 * Every public URL carries a sealed ticket (account ref, episode id, session id, expiry), so
 * only URLs this backend handed out work. A playback session starts when the manifest is first
 * requested (opening a page doesn't use one of the account's concurrent streams), is renewed by
 * the player's keep-alive, and is released when the player says so or after it goes idle.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Stream, Subtitle } from "@tube/shared";
import { fail, type ServiceEnv } from "../../kit/src/service.ts";
import { API, api, auth, bearer, CrunchyrollError, send, stream } from "./client.ts";
import { open, randomToken, seal } from "./crypto.ts";

type Ticket = { ref: string; id: string; sid: string };

type Play = {
  token: string;
  url: string;
  drm?: { name?: string; drmUrl?: string };
  subtitles?: Record<string, { format?: string; language?: string; url?: string }>;
  session?: { renewSeconds?: number };
};

type Session = { ticket: Ticket; play: Promise<Play>; started: number; seen: number };

/** Live sessions by id; one per account and episode. */
const sessions = new Map<string, Session>();
const byItem = new Map<string, string>();

const TICKET_SECONDS = 8 * 3600;
const IDLE_MS = 12 * 60_000;

const subtitleLabel = (locale: string) => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    const [lang, region] = locale.split("-");
    const base = names.of(lang!) ?? locale;
    // Regional variants Crunchyroll distinguishes: Spanish (Latin America) vs (Spain), Portuguese (Brazil).
    if (locale === "es-419") return `${base} (Latin America)`;
    if (region && ["es-ES", "pt-BR", "pt-PT", "fr-CA"].includes(locale)) return `${base} (${new Intl.DisplayNames(["en"], { type: "region" }).of(region)})`;
    return base;
  } catch {
    return locale;
  }
};

/** The stream for an episode: URLs only; Crunchyroll's session starts on first manifest load. */
export function streamFor(ref: string, id: string, subtitleLocales: string[]): Stream {
  const sid = randomToken(12);
  const t = seal({ ref, id, sid } satisfies Ticket, TICKET_SECONDS);
  const base = `/public/play/${t}`;
  return {
    dash: `${base}/manifest.mpd`,
    drm: { widevine: `${base}/license/widevine` },
    subtitles: subtitleLocales
      .filter((l) => l && l !== "none")
      .map((locale): Subtitle => ({ locale, label: subtitleLabel(locale), url: `${base}/subtitles/${locale}.ass`, format: "ass" })),
    session: { keepAlive: `${base}/keepalive`, release: `${base}/release`, everySeconds: 240 },
  };
}

function ticketOf(c: Context): Ticket {
  const ticket = open<Ticket>(c.req.param("ticket") ?? "");
  if (!ticket) throw fail(403, "This playback link expired. Reload the page.", "expired");
  return ticket;
}

/** Start (or reuse) the Crunchyroll playback session behind a ticket. */
function session(ticket: Ticket): Session {
  const existing = sessions.get(ticket.sid);
  if (existing) {
    existing.seen = Date.now();
    return existing;
  }
  // A new page load for the same account and episode replaces the old session.
  const key = `${ticket.ref}|${ticket.id}`;
  const previous = byItem.get(key);
  if (previous) void release(previous);
  const play = api<Play>(ticket.ref, `/playback/v3/${ticket.id}/tv/android_tv/play`).catch((error: Error) => {
    sessions.delete(ticket.sid);
    if (error instanceof CrunchyrollError && error.status === 420) throw fail(429, "Too many streams on this Crunchyroll account right now.", "stream_limit");
    if (error instanceof CrunchyrollError && error.status === 403) throw fail(403, "Crunchyroll didn't allow this episode on this account (Premium or region).", "forbidden");
    throw error;
  });
  const created: Session = { ticket, play, started: Date.now(), seen: Date.now() };
  sessions.set(ticket.sid, created);
  byItem.set(key, ticket.sid);
  return created;
}

async function release(sid: string) {
  const s = sessions.get(sid);
  if (!s) return;
  sessions.delete(sid);
  const key = `${s.ticket.ref}|${s.ticket.id}`;
  if (byItem.get(key) === sid) byItem.delete(key);
  try {
    const play = await s.play;
    const a = await auth(s.ticket.ref);
    await send(`${API}/playback/v1/token/${s.ticket.id}/${play.token}`, { method: "DELETE", headers: bearer(a.token) });
  } catch {
    // Already gone; Crunchyroll expires sessions on its own too.
  }
}

// Release sessions nobody is watching any more.
setInterval(() => {
  for (const [sid, s] of sessions) if (Date.now() - s.seen > IDLE_MS) void release(sid);
}, 60_000).unref();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await Promise.allSettled([...sessions.keys()].map(release));
    process.exit(0);
  });
}

const cdnHosts = /(^|\.)(crunchyrollcdn\.com|crunchyroll\.com|vrv\.co)$/;

export const playbackRoutes = new Hono<ServiceEnv>();

playbackRoutes.get("/play/:ticket/manifest.mpd", async (c) => {
  const ticket = ticketOf(c);
  const play = await session(ticket).play;
  const a = await auth(ticket.ref);
  const url = new URL(play.url);
  url.searchParams.set("accountid", a.accountId);
  url.searchParams.set("playbackGuid", play.token);
  const raw = await send(url.toString(), { headers: bearer(a.token) });
  if (raw.status !== 200) throw fail(502, `Crunchyroll didn't return the stream (${raw.status}).`, "upstream");
  // Segments come back through this backend: BaseURLs become /seg/<base64 of the CDN URL>/,
  // so relative segment paths resolve under them.
  const prefix = `${c.get("base")}/public/play/${c.req.param("ticket")}/seg`;
  const mpd = raw.body.toString("utf8").replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_, href: string) => {
    const absolute = new URL(href.replaceAll("&amp;", "&"), url).toString();
    return `<BaseURL>${prefix}/${Buffer.from(absolute).toString("base64url")}/</BaseURL>`;
  });
  return c.body(mpd, 200, { "content-type": "application/dash+xml", "cache-control": "no-store" });
});

playbackRoutes.get("/play/:ticket/seg/:b64/*", async (c) => {
  const ticket = ticketOf(c);
  const s = sessions.get(ticket.sid);
  if (s) s.seen = Date.now();
  const base = new URL(Buffer.from(c.req.param("b64"), "base64url").toString("utf8"));
  if (base.protocol !== "https:" || !cdnHosts.test(base.hostname)) throw fail(403, "Host not allowed.");
  // The part after the base, plus the request's own query (segment templates), joined onto the CDN URL.
  const rest = c.req.path.split(`/seg/${c.req.param("b64")}/`)[1] ?? "";
  const target = rest ? new URL(rest + (new URL(c.req.url).search || ""), base) : base;
  const range = c.req.header("range");
  let upstream: Awaited<ReturnType<typeof stream>>;
  try {
    upstream = await stream(target.toString(), range ? { range } : {}, c.req.raw.signal);
  } catch (error) {
    // The player cancels segment requests all the time (seeking, quality switches, leaving).
    if (c.req.raw.signal.aborted) return new Response(null, { status: 204 });
    throw error;
  }
  const headers = new Headers({ "cache-control": "private, max-age=3600" });
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers[name];
    if (value) headers.set(name, String(value));
  }
  const body = new ReadableStream({
    start(controller) {
      upstream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      upstream.on("end", () => controller.close());
      upstream.on("error", (error) => controller.error(error));
    },
    cancel() {
      upstream.destroy();
    },
  });
  return new Response(body, { status: upstream.statusCode ?? 502, headers });
});

playbackRoutes.post("/play/:ticket/license/widevine", async (c) => {
  const ticket = ticketOf(c);
  const play = await session(ticket).play;
  if (!play.drm?.drmUrl) throw fail(502, "Crunchyroll didn't offer a licence for this stream.", "upstream");
  const a = await auth(ticket.ref);
  const res = await send(play.drm.drmUrl, {
    method: "POST",
    headers: { ...bearer(a.token), "content-type": "application/octet-stream", "x-cr-content-id": ticket.id, "x-cr-video-token": play.token },
    body: Buffer.from(await c.req.arrayBuffer()),
  });
  let out = res.body;
  // Some licence endpoints wrap the licence in JSON.
  if (String(res.headers["content-type"] ?? "").includes("json")) {
    const wrapped = JSON.parse(out.toString("utf8")) as { license?: string };
    if (wrapped.license) out = Buffer.from(wrapped.license, "base64");
  }
  if (res.status !== 200) console.warn("licence refused:", res.status, out.toString("utf8").slice(0, 200));
  return c.body(new Uint8Array(out), res.status === 200 ? 200 : 502, { "content-type": "application/octet-stream", "cache-control": "no-store" });
});

playbackRoutes.get("/play/:ticket/subtitles/:file", async (c) => {
  const ticket = ticketOf(c);
  const locale = c.req.param("file").replace(/\.ass$/, "");
  const play = await session(ticket).play;
  const track = play.subtitles?.[locale];
  if (!track?.url) throw fail(404, "No subtitles in that language.", "not_found");
  const url = new URL(track.url);
  if (!cdnHosts.test(url.hostname)) throw fail(403, "Host not allowed.");
  const res = await send(url.toString());
  if (res.status !== 200) throw fail(502, "Couldn't load the subtitles.", "upstream");
  return c.body(new Uint8Array(res.body), 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "private, max-age=3600" });
});

let keepAliveSupported = true;

playbackRoutes.post("/play/:ticket/keepalive", async (c) => {
  const ticket = ticketOf(c);
  const s = sessions.get(ticket.sid);
  if (!s) return c.json({ ok: false, reason: "no session" });
  s.seen = Date.now();
  const position = Math.max(0, Math.floor(Number(new URL(c.req.url).searchParams.get("position")) || 0));
  if (keepAliveSupported) {
    try {
      const play = await s.play;
      const a = await auth(ticket.ref);
      const res = await send(`${API}/playback/v1/token/${ticket.id}/${play.token}/keepAlive?playhead=${position}`, { method: "PATCH", headers: bearer(a.token) });
      if (res.status === 404 || res.status === 405) keepAliveSupported = false;
    } catch {
      // Best effort: sessions also stay alive through licence and segment traffic.
    }
  }
  return c.json({ ok: true });
});

playbackRoutes.post("/play/:ticket/release", async (c) => {
  const ticket = ticketOf(c);
  await release(ticket.sid);
  return c.json({ ok: true });
});
