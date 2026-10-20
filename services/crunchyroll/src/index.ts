/*
 * Crunchyroll backend for Fanoos: speaks the provider protocol (packages/shared/src/protocol.ts).
 *
 * Accounts link with the TV activation code (Fanoos never sees the password) and need Premium.
 * Unlike YouTube, nothing here is anonymous: browsing and playback happen as the linked account,
 * and Crunchyroll keeps the watch history. Video stays DRM-encrypted to the browser (playback.ts).
 */
import type { BackendInfo, ChannelPage, Followed, LinkRequest, LinkStart, LinkStatus, ProviderAccount, ResolvedLink, SearchResults, Video, VideoDetail } from "@tube/shared";
import type { Context } from "hono";
import { accountParam, createService, fail, type ServiceEnv } from "../../kit/src/service.ts";
import {
  episodes,
  forget,
  history,
  object,
  objects,
  search,
  seasons,
  seriesMany,
  skipSegments,
  toSeries,
  toVideo,
  upNext,
  watchlist,
} from "./catalog.ts";
import { mapLimit } from "../../kit/src/cache.ts";
import { API, api, bearer, CrunchyrollError, deviceCode, deviceToken, send } from "./client.ts";
import { config } from "./config.ts";
import { encrypt, randomId, randomToken } from "./crypto.ts";
import { db, pending } from "./db.ts";
import { mediaRoutes, proxyImage } from "./media.ts";
import { playbackRoutes, streamFor } from "./playback.ts";

const info = (): BackendInfo => ({
  protocol: 1,
  kind: "crunchyroll",
  name: "Crunchyroll",
  color: "#ff640a",
  nouns: { channel: "show", channels: "shows", video: "episode", videos: "episodes", follow: "Add to watchlist", following: "In watchlist" },
  link: {
    method: "device",
    configured: Boolean(config.basicAuth),
    can: ["Browse and play as your account", "See and edit your watchlist", "Keep your watch history and progress"],
    cannot: ["See your password (you sign in on crunchyroll.com)", "Change your plan or payment details", "Decrypt video: your browser does that"],
    requirement: "Needs a Crunchyroll Premium membership.",
  },
  features: ["feed", "calendar", "search", "follow", "progress", "segments"],
  linkHosts: ["crunchyroll.com", "www.crunchyroll.com"],
  urls: { video: "https://www.crunchyroll.com/watch/{id}", channel: "https://www.crunchyroll.com/series/{id}" },
  private: false,
});

const service = createService(config, info);
const { v1, pub } = service;
pub.route("/", mediaRoutes);
pub.route("/", playbackRoutes);

const crId = (id: string | undefined) => {
  if (!id || !/^[A-Z0-9]{6,20}$/.test(id)) throw fail(400, "Invalid id.");
  return id;
};

/** Upstream failures as protocol errors. */
async function upstream<T>(label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { getResponse?: unknown }).getResponse) throw error;
    if (error instanceof CrunchyrollError && error.status === 404) throw fail(404, `Crunchyroll has no ${label} like that.`, "not_found");
    console.warn(`${label} failed:`, (error as Error).message);
    throw fail(502, `Couldn't load ${label} from Crunchyroll.`, "upstream");
  }
}

/** Every request but linking acts as a linked account: the first usable one of those core sent. */
function actor(c: Context<ServiceEnv>): string {
  const refs = usable(c.get("accounts"));
  if (!refs.length) throw fail(409, "Link a Crunchyroll account to browse and watch.", "no_account");
  return refs[0]!;
}

function usable(refs: string[]): string[] {
  if (!refs.length) return [];
  const rows = db.prepare(`SELECT ref FROM accounts WHERE needs_relink = 0 AND ref IN (${refs.map(() => "?").join(",")})`).all(...refs) as { ref: string }[];
  const ok = new Set(rows.map((r) => r.ref));
  return refs.filter((r) => ok.has(r));
}

// ---------------------------------------------------------------------------
// Accounts and linking (TV activation code)

type AccountRow = { ref: string; name: string; email: string; avatar: string | null; plan: string | null; needs_relink: number };

function account(ref: string): ProviderAccount {
  const row = db.prepare("SELECT ref, name, email, avatar, plan, needs_relink FROM accounts WHERE ref = ?").get(ref) as AccountRow | undefined;
  if (!row) throw fail(404, "Account not found.", "not_found");
  return {
    ref: row.ref,
    name: row.name,
    email: row.email || undefined,
    avatar: row.avatar ? proxyImage(row.avatar) : undefined,
    // Watchlist changes are the account's own; there's no separate permission to ask for.
    canWrite: true,
    plan: row.plan ?? undefined,
    needsRelink: Boolean(row.needs_relink) || undefined,
  };
}

type Flow = LinkRequest & { deviceId: string; deviceCode: string; status: LinkStatus; polled: number };

v1.post("/links", async (c) => {
  if (!config.basicAuth) throw fail(503, "Crunchyroll isn't set up on this backend (CRUNCHYROLL_BASIC_AUTH).", "not_configured");
  const body = await c.req.json<LinkRequest>();
  const deviceId = crypto.randomUUID();
  const code = await upstream("an activation code", () => deviceCode(deviceId));
  const flow = randomToken(24);
  pending.put("link", flow, { ...body, deviceId, deviceCode: code.device_code, status: { status: "pending" }, polled: 0 } satisfies Flow, code.expires_in * 1000);
  return c.json({
    flow,
    kind: "device",
    code: code.user_code.toUpperCase(),
    verifyUrl: "https://www.crunchyroll.com/activate",
    expiresIn: code.expires_in,
    interval: Math.max(3, Math.ceil(code.interval / 1000) || 3),
  } satisfies LinkStart);
});

v1.get("/links/:flow", async (c) => {
  const id = c.req.param("flow");
  const flow = pending.get<Flow>("link", id);
  if (!flow) return c.json({ status: "failed", error: "The code expired. Start again for a new one.", code: "expired" } satisfies LinkStatus);
  if (flow.status.status !== "pending") {
    pending.delete(id);
    return c.json(flow.status);
  }
  // Core polls on the browser's behalf; don't hit Crunchyroll more often than every 3 s.
  if (Date.now() - flow.polled < 2500) return c.json(flow.status);
  pending.put("link", id, { ...flow, polled: Date.now() });
  const tokens = await deviceToken(flow.deviceCode).catch((error: Error) => {
    console.warn("activation poll failed:", error.message);
    return null;
  });
  if (!tokens) return c.json({ status: "pending" } satisfies LinkStatus);

  const status = await adopt(tokens, flow.deviceId, flow.account).catch((error: Error): LinkStatus => {
    console.warn("Crunchyroll linking failed:", error.message);
    return { status: "failed", error: "Crunchyroll accepted the code, but the account couldn't be loaded. Try again.", code: "provider" };
  });
  pending.delete(id);
  return c.json(status);
});

/** Turn fresh tokens into a linked account (checking Premium first). */
async function adopt(tokens: { access_token: string; refresh_token?: string; account_id?: string; profile_id?: string }, deviceId: string, relink?: string): Promise<LinkStatus> {
  const get = async <T>(path: string) => {
    const raw = await send(`${API}${path}`, { headers: bearer(tokens.access_token) });
    if (raw.status !== 200) throw new CrunchyrollError(raw.status, `${path} ${raw.status}`);
    return JSON.parse(raw.body.toString("utf8")) as T;
  };
  const me = await get<{ account_id: string; external_id: string; email?: string }>("/accounts/v1/me");
  const profile = await get<{ username?: string; email?: string; avatar?: string; profile_name?: string }>("/accounts/v1/me/profile").catch(() => ({}) as Record<string, string>);
  const benefits = await get<{ items?: { benefit: string }[] }>(`/subs/v1/subscriptions/${me.external_id}/benefits`).catch(() => ({ items: [] }));
  const names = (benefits.items ?? []).map((b) => b.benefit);
  if (!names.includes("cr_premium")) {
    return { status: "failed", error: "This Crunchyroll account doesn't have Premium. Fanoos needs a Premium membership to play episodes.", code: "not_premium" };
  }
  const streams = Number(names.find((n) => n.startsWith("concurrent_streams."))?.split(".")[1] ?? 1);
  const plan = streams >= 6 ? "Ultimate Fan" : streams >= 4 ? "Mega Fan" : "Fan";
  const name = profile.profile_name || profile.username || "Crunchyroll";
  const email = profile.email ?? me.email ?? "";
  const avatar = profile.avatar ? `https://static.crunchyroll.com/assets/avatar/170x170/${profile.avatar}` : null;
  const refresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
  const existing = relink && (db.prepare("SELECT ref FROM accounts WHERE ref = ?").get(relink) as { ref: string } | undefined);
  const ref = existing ? existing.ref : randomId();
  if (existing) {
    db.prepare(
      "UPDATE accounts SET account_id = ?, profile_id = ?, external_id = ?, device_id = ?, name = ?, email = ?, avatar = ?, plan = ?, refresh_token = ?, needs_relink = 0 WHERE ref = ?",
    ).run(me.account_id, tokens.profile_id ?? null, me.external_id, deviceId, name, email, avatar, plan, refresh, ref);
  } else {
    db.prepare(
      "INSERT INTO accounts (ref, account_id, profile_id, external_id, device_id, name, email, avatar, plan, refresh_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(ref, me.account_id, tokens.profile_id ?? null, me.external_id, deviceId, name, email, avatar, plan, refresh, Date.now());
  }
  return { status: "linked", account: account(ref) };
}

v1.get("/accounts/:ref", (c) => c.json(account(c.req.param("ref"))));

v1.delete("/accounts/:ref", async (c) => {
  const ref = c.req.param("ref");
  const row = db.prepare("SELECT device_id FROM accounts WHERE ref = ?").get(ref) as { device_id: string } | undefined;
  // Deactivate this device at Crunchyroll, so unlinking really ends the session.
  if (row) await api(ref, `/accounts/v1/{account}/devices/${row.device_id}/deactivate`, { method: "POST" }).catch(() => {});
  db.prepare("DELETE FROM accounts WHERE ref = ?").run(ref);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Following (the watchlist), feed, continue watching

const NEW_WINDOW = 48 * 36e5;

v1.get("/following", async (c) =>
  c.json(
    await upstream("your watchlist", async () => {
      const refs = usable(c.get("accounts"));
      if (c.req.query("refresh") === "1") await Promise.all(refs.map(forget));
      const merged = new Map<string, Followed>();
      const lists = await Promise.all(refs.map(async (ref) => ({ ref, items: await watchlist(ref).catch(() => []) })));
      for (const { ref, items } of lists) {
        for (const item of items) {
          const m = item.panel?.episode_metadata;
          if (!m?.series_id) continue;
          const lastActivity = Date.parse(m.premium_available_date ?? m.availability_starts ?? "") / 1000 || undefined;
          const seen = merged.get(m.series_id);
          const fresh = Date.now() - Date.parse(m.premium_available_date ?? m.availability_starts ?? 0) < NEW_WINDOW && !item.fully_watched ? 1 : 0;
          if (seen) {
            if (!seen.via.includes(ref)) seen.via.push(ref);
            seen.unseen = Math.max(seen.unseen, fresh);
            seen.lastActivity = Math.max(seen.lastActivity ?? 0, lastActivity ?? 0) || undefined;
          } else merged.set(m.series_id, { id: m.series_id, provider: "crunchyroll", kind: "series", name: m.series_title ?? "", lastActivity, unseen: fresh, via: [ref] });
        }
      }
      if (refs[0] && merged.size) {
        const details = await seriesMany(refs[0], [...merged.keys()]);
        for (const [id, f] of merged) {
          const d = details.get(id);
          if (d) merged.set(id, { ...d, lastActivity: f.lastActivity, unseen: f.unseen, via: f.via });
        }
      }
      return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    }),
  ),
);

/** New episodes of shows on the watchlist (one per show: its newest available episode). */
v1.get("/feed", async (c) =>
  c.json(
    await upstream("new episodes", async () => {
      const refs = usable(c.get("accounts"));
      const byId = new Map<string, Video>();
      for (const ref of refs) {
        for (const item of await watchlist(ref).catch(() => [])) {
          if (!item.panel?.id) continue;
          const video = toVideo(item.panel);
          const existing = byId.get(video.id);
          if (existing) existing.via!.push(ref);
          else byId.set(video.id, { ...video, via: [ref], progress: item.playhead || undefined });
        }
      }
      return [...byId.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, Number(c.req.query("limit")) || 120);
    }),
  ),
);

/**
 * Episodes of watchlist shows released in [from, to), for the calendar: the two newest seasons of
 * each show (an airing season and, around a season change, the one before). Dates follow the
 * account's audio language, as everywhere else.
 */
v1.get("/calendar", async (c) =>
  c.json(
    await upstream("your calendar", async () => {
      const refs = usable(c.get("accounts"));
      const [start, end] = [Date.parse(c.req.query("from") ?? ""), Date.parse(c.req.query("to") ?? "")];
      const ref = refs[0];
      if (!ref || !(start < end)) return [];
      const shows = new Map<string, string[]>();
      for (const r of refs) for (const item of await watchlist(r).catch(() => [])) {
        const id = item.panel?.episode_metadata?.series_id;
        if (id) shows.set(id, [...new Set([...(shows.get(id) ?? []), r])]);
      }
      const found = await mapLimit([...shows], 6, async ([seriesId, via]) => {
        const list = (await seasons(ref, seriesId).catch(() => []))
          .slice()
          .sort((a, b) => (a.season_sequence_number ?? a.season_number ?? 0) - (b.season_sequence_number ?? b.season_number ?? 0))
          .slice(-2);
        const eps = (await Promise.all(list.map((s) => episodes(ref, s.id).catch(() => [])))).flat();
        return eps
          .map((e) => ({ ...toVideo(e), via }))
          .filter((v) => Date.parse(v.published) >= start && Date.parse(v.published) < end);
      });
      return found.flat().sort((a, b) => a.published.localeCompare(b.published));
    }),
  ),
);

/** Episodes started but not finished, newest first, with Crunchyroll's saved positions. */
v1.get("/continue", async (c) =>
  c.json(
    await upstream("continue watching", async () => {
      const refs = usable(c.get("accounts"));
      const entries = (await Promise.all(refs.map(async (ref) => (await history(ref).catch(() => [])).map((h) => ({ ...h, ref }))))).flat();
      const open = entries
        .filter((h) => !h.fully_watched && h.playhead > 30 && h.id)
        .sort((a, b) => String(b.date_played).localeCompare(String(a.date_played)))
        .filter((h, i, all) => all.findIndex((x) => x.parent_id === h.parent_id) === i)
        .slice(0, 12);
      if (!open.length) return [];
      const found = new Map((await objects(refs[0]!, open.map((h) => h.id))).map((o) => [o.id, o]));
      return open.filter((h) => found.has(h.id)).map((h) => ({ ...toVideo(found.get(h.id)), progress: h.playhead, via: [h.ref] }));
    }),
  ),
);

// ---------------------------------------------------------------------------
// Episodes, shows, search

v1.get("/videos/:id", async (c) => {
  const ref = actor(c);
  const id = crId(c.req.param("id"));
  const body = await upstream("this episode", async () => {
    const item = await object(ref, id);
    if (!item) throw new CrunchyrollError(404, "episode not found");
    const video = toVideo(item);
    const series = video.episode?.seriesId ? ((await seriesMany(ref, [video.episode.seriesId])).get(video.episode.seriesId) ?? null) : null;
    // Up next: the rest of this season, in order, then nothing (no recommendations).
    const season = video.episode?.seasonId ? await episodes(ref, video.episode.seasonId).catch(() => []) : [];
    const index = season.findIndex((e) => e.id === id);
    const next = (index >= 0 ? [...season.slice(index + 1), ...season.slice(0, index)] : season).map(toVideo);
    const [segments, playhead] = await Promise.all([
      skipSegments(id).catch(() => []),
      api<{ data: { playhead: number; fully_watched: boolean }[] }>(ref, "/content/v2/{account}/playheads", { query: { content_ids: id } }).catch(() => null),
    ]);
    const position = playhead?.data?.[0];
    const detail: VideoDetail = {
      video: {
        ...video,
        channelAvatar: series?.avatar,
        segments,
        progress: position && !position.fully_watched ? position.playhead : undefined,
      },
      channel: series ?? { id: video.channelId, provider: "crunchyroll", kind: "series", name: video.channelName, unseen: 0 },
      next,
      stream: streamFor(ref, id, video.episode?.subtitles ?? []),
    };
    return detail;
  });
  return c.json(body);
});

v1.get("/videos", async (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").filter((id) => /^[A-Z0-9]{6,20}$/.test(id)).slice(0, 50);
  if (!ids.length) return c.json([]);
  const ref = actor(c);
  const found = await upstream("episodes", () => objects(ref, ids));
  return c.json(found.filter((o) => o.type === "episode" || o.episode_metadata).map(toVideo));
});

v1.get("/channels/:id", async (c) => {
  const ref = actor(c);
  const id = crId(c.req.param("id"));
  const page = await upstream("this show", async () => {
    const series = (await seriesMany(ref, [id])).get(id);
    if (!series) throw new CrunchyrollError(404, "series not found");
    const list = await seasons(ref, id);
    // Default to the season of the episode up next; else the first.
    const wanted = c.req.query("section");
    let section = list.find((s) => s.id === wanted)?.id;
    if (!section) {
      const next = await upNext(ref, id);
      const nextSeason = next ? (await object(ref, next.id))?.episode_metadata?.season_id : undefined;
      section = list.find((s) => s.id === nextSeason)?.id ?? list[0]?.id;
    }
    const videos = section ? (await episodes(ref, section)).map(toVideo) : [];
    const result: ChannelPage = {
      channel: { ...series, videoCount: series.videoCount ?? list.reduce((n, s) => n + (s.number_of_episodes ?? 0), 0) },
      videos,
      sections: list.map((s) => ({
        id: s.id,
        label: s.title || `Season ${s.season_number}`,
        count: s.number_of_episodes,
      })),
      section,
    };
    return result;
  });
  return c.json(page);
});

v1.get("/channels/:id/followers", async (c) => {
  const id = crId(c.req.param("id"));
  const refs = usable(c.get("accounts"));
  const following = await Promise.all(
    refs.map(async (ref) => ((await watchlist(ref).catch(() => [])).some((i) => i.panel?.episode_metadata?.series_id === id) ? ref : null)),
  );
  return c.json(following.filter(Boolean));
});

v1.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const type = c.req.query("type") ?? "all";
  if (!q || !usable(c.get("accounts")).length) return c.json({ channels: [], videos: [] } satisfies SearchResults);
  const ref = actor(c);
  const found = await upstream("search results", () => search(ref, q));
  // Every dub of an episode is its own result; keep one per episode (the original audio when it's there).
  const episodes = new Map<string, Video>();
  for (const v of found.episodes.map(toVideo)) {
    const key = `${v.episode?.seriesId}|${v.episode?.season}|${v.episode?.number}|${v.title}`;
    const original = v.episode?.versions?.find((x) => x.original)?.audio;
    if (!episodes.has(key) || v.episode?.audio === original) episodes.set(key, v);
  }
  const result: SearchResults = {
    channels: type === "video" ? [] : found.series.map(toSeries),
    videos: type === "channel" ? [] : [...episodes.values()],
  };
  return c.json(result);
});

v1.get("/playlists", (c) => c.json([]));

// Pasted links: crunchyroll.com[/xx]/watch/<id>/<slug> and /series/<id>/<slug>.
v1.get("/resolve", (c) => {
  let url: URL;
  try {
    url = new URL(c.req.query("url") ?? "");
  } catch {
    throw fail(400, "Not a link.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (/^[a-z]{2}(-[a-z]{2,3})?$/i.test(parts[0] ?? "")) parts.shift();
  const id = parts[1]?.toUpperCase();
  let found: ResolvedLink | null = null;
  if (id && /^[A-Z0-9]{6,20}$/.test(id)) {
    if (parts[0] === "watch") found = { type: "video", id, start: Number(url.searchParams.get("t")) || undefined };
    if (parts[0] === "series") found = { type: "channel", id };
  }
  if (!found) throw fail(404, "Nothing on Crunchyroll matches that link.", "not_found");
  return c.json(found);
});

// ---------------------------------------------------------------------------
// Actions as an account

v1.post("/actions/follow", async (c) => {
  const body = await c.req.json<{ account?: string; channelId?: string; on?: boolean }>();
  const ref = accountParam(c, body);
  const id = crId(body.channelId);
  await upstream("your watchlist", () =>
    body.on ? api(ref, "/content/v2/{account}/watchlist", { method: "POST", body: { content_id: id } }) : api(ref, `/content/v2/{account}/watchlist/${id}`, { method: "DELETE" }),
  );
  await forget(ref);
  return c.json({ ok: true });
});

v1.post("/actions/progress", async (c) => {
  const body = await c.req.json<{ account?: string; videoId?: string; position?: number }>();
  const ref = accountParam(c, body);
  const id = crId(body.videoId);
  const position = Math.max(0, Math.floor(Number(body.position) || 0));
  await api(ref, "/content/v2/{account}/playheads", { method: "POST", body: { content_id: id, playhead: position } }).catch((error: Error) =>
    console.warn("playhead save failed:", error.message),
  );
  return c.json({ ok: true });
});

v1.get("/actions/rating", () => {
  throw fail(501, "Crunchyroll ratings aren't supported.", "unsupported");
});
v1.post("/actions/rating", () => {
  throw fail(501, "Crunchyroll ratings aren't supported.", "unsupported");
});
v1.post("/actions/comments", () => {
  throw fail(501, "Crunchyroll has no comments.", "unsupported");
});
v1.get("/videos/:id/comments", (c) => c.json({ comments: [] }));

service.start();
