/*
 * YouTube backend for Fanoos: speaks the provider protocol (packages/shared/src/protocol.ts).
 * Accounts link with Google OAuth; public content comes from YouTube.js signed out; playback
 * streams through Invidious companion; everything the browser loads goes through /public.
 */
import type {
  BackendInfo,
  Comment,
  CommentSort,
  LinkRequest,
  LinkStart,
  LinkStatus,
  Playlist,
  ProviderAccount,
  ResolvedLink,
  SearchFilters,
  SearchResults,
  VideoDetail,
} from "@tube/shared";
import type { Context } from "hono";
import { accountParam, createService, fail, type ServiceEnv } from "../../kit/src/service.ts";
import { SharedCache, TtlCache } from "./cache.ts";
import { channelListKey } from "./channel-list.ts";
import { config } from "./config.ts";
import { decrypt, encrypt, randomId, randomToken } from "./crypto.ts";
import { db, pending } from "./db.ts";
import { communityTitle, segments, votes } from "./extras.ts";
import { calendar, feed, followedSet, followers, subscriptions, syncSubscriptions } from "./feed.ts";
import {
  authorizationUrl,
  canWrite,
  exchangeCode,
  fetchPlaylists,
  getRating,
  postComment,
  QuotaExceeded,
  rate,
  type Rating,
  RelinkRequired,
  revoke,
  subscribe,
  unsubscribe,
  userInfo,
  WriteNotAllowed,
} from "./google.ts";
import { channelAbout, channelContinuation, channelPage, comments, replies, search, videoDetail, yt } from "./innertube.ts";
import { mediaRoutes, proxyImage } from "./media.ts";
import { getSettings, setSetting } from "./settings.ts";
import { resumeSignedIn, signedInState, signOutSignedIn, startSignedIn } from "./signed-in.ts";
import { dashManifest, playability, subtitles } from "./stream.ts";

const info = (): BackendInfo => ({
  protocol: 1,
  kind: "youtube",
  name: "YouTube",
  color: "#ff0033",
  nouns: { channel: "channel", channels: "channels", video: "video", videos: "videos", follow: "Subscribe", following: "Subscribed" },
  link: {
    method: "redirect",
    configured: config.google.configured,
    can: ["See your subscriptions", "See your playlists", "See basic profile info"],
    cannot: ["See your watch history", "Upload or change your account", "Act without you pressing a button"],
    writeOption: {
      label: "Allow subscribing, liking and commenting",
      description: "Adds YouTube’s “manage your account” permission. Leave it off to link read-only; you can allow it later.",
      can: ["Subscribe and unsubscribe", "Like and dislike", "Comment and reply"],
    },
  },
  features: ["feed", "calendar", "search", "comments", "ratings", "follow", "playlists", "dislikes", "segments", "titles"],
  linkHosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"],
  urls: { video: "https://www.youtube.com/watch?v={id}", channel: "https://www.youtube.com/channel/{id}" },
  private: true,
  admin: ["age-restricted"],
});

const service = createService(config, info);
const { v1, pub } = service;
pub.route("/", mediaRoutes);

const videoId = (id: string | undefined) => {
  if (!id || !/^[\w-]{11}$/.test(id)) throw fail(400, "Invalid video id.");
  return id;
};
const channelId = (id: string | undefined) => {
  if (!id || !/^UC[\w-]{22}$/.test(id)) throw fail(400, "Invalid channel id.");
  return id;
};

/** Upstream failures (YouTube changes, network, Google) as protocol errors. */
async function upstream<T>(label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RelinkRequired) throw fail(409, "A linked account needs to be linked again.", "relink");
    if (error instanceof QuotaExceeded) throw fail(429, "Today's YouTube quota for this server is used up. Actions work again after midnight Pacific time.", "quota");
    if (error instanceof WriteNotAllowed) throw fail(403, "Google refused: this account hasn't granted permission for actions. Allow actions again in Settings.", "read_only");
    if ((error as { status?: number }).status && (error as { getResponse?: unknown }).getResponse) throw error;
    const reason = (error as { reason?: string }).reason ?? "";
    if (reason === "commentsDisabled") throw fail(422, "Comments are turned off for this video.", "comments_disabled");
    if (reason === "subscriptionForbidden" || reason === "subscriptionNotFound") throw fail(422, "YouTube didn't allow that subscription change.", reason);
    console.warn(`${label} failed:`, (error as Error).message);
    throw fail(502, `Couldn't load ${label} from YouTube.`, "upstream");
  }
}

// ---------------------------------------------------------------------------
// Accounts and linking

type AccountRow = { ref: string; name: string; email: string; avatar: string | null; scopes: string; needs_relink: number };

const account = (ref: string): ProviderAccount => {
  const row = db.prepare("SELECT ref, name, email, avatar, scopes, needs_relink FROM accounts WHERE ref = ?").get(ref) as AccountRow | undefined;
  if (!row) throw fail(404, "Account not found.", "not_found");
  return {
    ref: row.ref,
    name: row.name,
    email: row.email,
    avatar: row.avatar ? proxyImage(row.avatar) : undefined,
    canWrite: canWrite(row.scopes),
    needsRelink: Boolean(row.needs_relink) || undefined,
  };
};

type Flow = LinkRequest & { verifier: string; status: LinkStatus };

v1.post("/links", async (c) => {
  if (!config.google.configured) throw fail(503, "Google sign-in isn't set up on this backend (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).", "not_configured");
  const body = await c.req.json<LinkRequest>();
  const flow = randomToken(24);
  const hint = body.account ? (db.prepare("SELECT email FROM accounts WHERE ref = ?").get(body.account) as { email: string } | undefined)?.email : undefined;
  const { url, verifier } = authorizationUrl(flow, { write: body.write, loginHint: hint });
  pending.put("link", flow, { ...body, verifier, status: { status: "pending" } } satisfies Flow);
  return c.json({ flow, kind: "redirect", url } satisfies LinkStart);
});

v1.get("/links/:flow", (c) => {
  const flow = pending.get<Flow>("link", c.req.param("flow"));
  if (!flow) return c.json({ status: "failed", error: "That sign-in expired. Try again.", code: "expired" } satisfies LinkStatus);
  if (flow.status.status !== "pending") pending.delete(c.req.param("flow"));
  return c.json(flow.status);
});

// Google sends the browser here (through core's /api/b/youtube proxy), then on to core.
pub.get("/oauth/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  const flow = pending.get<Flow>("link", state);
  if (!flow) return c.text("This sign-in expired. Close this tab and try again.", 410);
  const finish = (status: LinkStatus) => {
    pending.put("link", state, { ...flow, status });
    return c.redirect(flow.returnUrl);
  };
  const code = c.req.query("code");
  if (!code) return finish({ status: "failed", error: "Sign-in was cancelled at Google.", code: c.req.query("error") ?? "denied" });
  try {
    const tokens = await exchangeCode(code, flow.verifier);
    if (!tokens.scope.includes("youtube.readonly")) return finish({ status: "failed", error: "Google didn't grant access to YouTube. Tick the YouTube box when signing in.", code: "scope" });
    const who = await userInfo(tokens.access_token);
    const existing = flow.account
      ? (db.prepare("SELECT ref, refresh_token FROM accounts WHERE ref = ?").get(flow.account) as { ref: string; refresh_token: string | null } | undefined)
      : undefined;
    const refresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : (existing?.refresh_token ?? null);
    let ref = existing?.ref;
    if (ref) {
      db.prepare(
        "UPDATE accounts SET sub = ?, name = ?, email = ?, avatar = ?, refresh_token = ?, access_token = ?, access_expires = ?, scopes = ?, needs_relink = 0, synced_at = 0 WHERE ref = ?",
      ).run(who.sub, who.name ?? who.email, who.email, who.picture ?? null, refresh, encrypt(tokens.access_token), Date.now() + tokens.expires_in * 1000, tokens.scope, ref);
    } else {
      ref = randomId();
      db.prepare(
        `INSERT INTO accounts (ref, sub, name, email, avatar, refresh_token, access_token, access_expires, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ref, who.sub, who.name ?? who.email, who.email, who.picture ?? null, refresh, encrypt(tokens.access_token), Date.now() + tokens.expires_in * 1000, tokens.scope, Date.now());
    }
    // Pull the subscription list now so the feed is ready on return; errors surface later.
    await syncSubscriptions(ref, true).catch((error) => console.warn("initial sync failed:", (error as Error).message));
    // Asked for actions but the consent screen had that box unticked: linked read-only.
    if (flow.write && !canWrite(tokens.scope)) {
      return finish({ status: "linked", account: account(ref), write: false });
    }
    return finish({ status: "linked", account: account(ref), write: flow.write });
  } catch (error) {
    console.warn("Google linking failed:", (error as Error).message);
    return finish({ status: "failed", error: "Google didn't complete the sign-in. Try again.", code: "provider" });
  }
});

v1.get("/accounts/:ref", (c) => c.json(account(c.req.param("ref"))));

v1.delete("/accounts/:ref", async (c) => {
  const row = db.prepare("SELECT refresh_token FROM accounts WHERE ref = ?").get(c.req.param("ref")) as { refresh_token: string | null } | undefined;
  // Revoke at Google too, so unlinking really removes access.
  if (row?.refresh_token) await revoke(decrypt(row.refresh_token));
  db.prepare("DELETE FROM accounts WHERE ref = ?").run(c.req.param("ref"));
  return c.json({ ok: true });
});

/** Adopt a Google account linked before backends were separate services (core's one-time migration). */
v1.post("/accounts/import", async (c) => {
  const { credentials: k } = await c.req.json<{ credentials: Record<string, string | number | null> }>();
  if (typeof k.refreshToken !== "string" || typeof k.sub !== "string") throw fail(400, "Missing refreshToken or sub.");
  const ref = randomId();
  db.prepare(`INSERT INTO accounts (ref, sub, name, email, avatar, refresh_token, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    ref,
    k.sub,
    String(k.name ?? k.email ?? "Google account"),
    String(k.email ?? ""),
    (k.avatar as string | null) ?? null,
    encrypt(k.refreshToken),
    String(k.scopes ?? ""),
    Date.now(),
  );
  await syncSubscriptions(ref, true).catch(() => {});
  return c.json(account(ref));
});

// ---------------------------------------------------------------------------
// Content

const refs = (c: Context<ServiceEnv>) => c.get("accounts");

v1.get("/following", async (c) => c.json(await upstream("subscriptions", () => subscriptions(refs(c), c.req.query("refresh") === "1"))));

v1.get("/feed", async (c) => c.json(await upstream("your feed", () => feed(refs(c), Number(c.req.query("limit")) || 120))));
v1.get("/calendar", async (c) => c.json(await upstream("your calendar", () => calendar(refs(c), c.req.query("from") ?? "", c.req.query("to") ?? ""))));

// YouTube progress lives in the Fanoos account (app data), not on YouTube.
v1.get("/continue", (c) => c.json([]));

/** Bump when the manifest or its segment-URL format changes. */
const MANIFEST_VERSION = 4;

// Old detail entries used a guessed hq720 URL instead of YouTube's full-size artwork.
const details = new SharedCache<Omit<VideoDetail, "stream">>("video-thumbnails-v2");
const channels = new SharedCache<Awaited<ReturnType<typeof channelPage>>>("channel");
const searches = new SharedCache<SearchResults>("search");
const channelDescriptions = new SharedCache<Awaited<ReturnType<typeof channelAbout>>>("channel-about");
const playlistCache = new SharedCache<Playlist[]>("playlists");
const channelCached = (id: string) => channels.get(id, () => channelPage(id));
// Browsing responses contain process-local cursors. Never put them in the shared Redis cache.
// The first page lives for less time than its continuation, so refresh always yields a usable cursor.
const browsingChannels = new TtlCache<Awaited<ReturnType<typeof channelPage>>>(60_000, 500);

v1.get("/videos/:id", async (c) => {
  const id = videoId(c.req.param("id"));
  const detail = await upstream("this video", () => details.get(id, () => videoDetail(id)));
  const [segs, vote, alt, fromChannel, play] = await Promise.all([
    segments(id),
    votes(id),
    communityTitle(id).catch(() => undefined),
    channelCached(detail.channel.id).catch(() => null),
    playability(id).catch((): Awaited<ReturnType<typeof playability>> => ({ ok: false, code: "unplayable", reason: "Couldn't reach the streaming service." })),
  ]);
  // Up next: this channel's uploads, then related videos only from channels the accounts follow.
  // YouTube's recommendations for anything else are dropped.
  const followed = followedSet(refs(c));
  const seen = new Set([id]);
  // YouTube sometimes omits the watch page's owner block; fill gaps from the channel page.
  const page = fromChannel?.channel;
  const channel = {
    ...detail.channel,
    avatar: detail.channel.avatar || page?.avatar,
    subscribers: detail.channel.subscribers || page?.subscribers,
    verified: detail.channel.verified || page?.verified,
  };
  const next = [...(fromChannel?.videos ?? []), ...detail.next.filter((v) => followed.has(v.channelId))].filter((v) => !seen.has(v.id) && seen.add(v.id)).slice(0, 20);
  const body: VideoDetail = {
    ...detail,
    channel,
    next,
    video: { ...detail.video, channelAvatar: detail.video.channelAvatar || channel.avatar, channelVerified: channel.verified, segments: segs, likes: vote?.likes ?? detail.video.likes, dislikes: vote?.dislikes, altTitle: alt },
    stream: detail.video.live
      ? { unavailable: { code: "live", reason: "Live streams can't be played here yet." } }
      : play.ok
        ? // The version bypasses manifests browsers cached under an older stream-URL scheme.
          { dash: `/public/videos/${id}/manifest.mpd?v=${MANIFEST_VERSION}`, subtitles: await subtitles(id, play.instance) }
        : { unavailable: { code: play.code, reason: play.reason } },
  };
  return c.json(body);
});

pub.get("/videos/:id/manifest.mpd", async (c) => {
  const id = videoId(c.req.param("id"));
  const mpd = await upstream("the video stream", () => dashManifest(id, c.get("base")));
  // Never cached: segment URLs expire, and a stale manifest breaks playback.
  return c.body(mpd, 200, { "content-type": "application/dash+xml", "cache-control": "no-store" });
});

v1.get("/videos/:id/comments", async (c) => {
  const sort: CommentSort = c.req.query("sort") === "new" ? "new" : "top";
  return c.json(await upstream("comments", () => comments(videoId(c.req.param("id")), sort, c.req.query("next") || undefined)));
});

v1.get("/comments/replies", async (c) => c.json(await upstream("replies", () => replies(c.req.query("token") ?? ""))));

/** Several videos by id (Watch later, history). Detail is cached, so this is cheap after first view. */
v1.get("/videos", async (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").filter((id) => /^[\w-]{11}$/.test(id)).slice(0, 50);
  const results = await Promise.all(ids.map((id) => details.get(id, () => videoDetail(id)).then((d) => d.video).catch(() => null)));
  return c.json(results.filter((v) => v !== null));
});

v1.get("/channels/:id", async (c) => {
  const id = channelId(c.req.param("id"));
  const next = c.req.query("next");
  const query = (c.req.query("q") ?? "").trim();
  const sort = c.req.query("sort") ?? "new";
  if (query.length > 200) throw fail(400, "Channel search is limited to 200 characters.");
  if (sort !== "new" && sort !== "popular") throw fail(400, "Invalid channel sort.");
  const options = { query, sort } as const;
  const key = channelListKey(id, options);
  const page = await upstream("this channel", () => next
    ? channelContinuation(id, next, options).catch((error: unknown) => {
        if ((error as { status?: number }).status === 410) browsingChannels.delete(key);
        throw error;
      })
    : browsingChannels.get(key, () => channelPage(id, true, options)));

  return c.json({ ...page, channel: { ...page.channel, feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${page.channel.id}` } });
});

v1.get("/channels/:id/about", async (c) => {
  const id = channelId(c.req.param("id"));
  return c.json(await upstream("this channel's description", () => channelDescriptions.get(id, () => channelAbout(id))));
});

v1.get("/channels/:id/followers", (c) => c.json(followers(refs(c), channelId(c.req.param("id")))));

v1.get("/playlists", async (c) => {
  const lists = await Promise.all(
    refs(c).map(async (ref) => {
      try {
        return await playlistCache.get(ref, async () =>
          (await fetchPlaylists(ref)).map((p): Playlist => ({ ...p, accountId: ref, thumbnail: proxyImage(p.thumbnail) })),
        );
      } catch {
        return [];
      }
    }),
  );
  return c.json(lists.flat());
});

v1.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  if (!q) return c.json({ channels: [], videos: [] });
  const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T) => (allowed.includes(value as T) ? (value as T) : fallback);
  const filters: SearchFilters = {
    type: pick(c.req.query("type"), ["all", "video", "channel"], "all"),
    duration: pick(c.req.query("duration"), ["any", "short", "medium", "long"], "any"),
    uploaded: pick(c.req.query("uploaded"), ["any", "today", "week", "month"], "any"),
    sort: pick(c.req.query("sort"), ["relevance", "date", "views"], "relevance"),
  };
  const key = `${q.toLowerCase()}|${filters.type}|${filters.duration}|${filters.uploaded}|${filters.sort}`;
  return c.json(await upstream("search results", () => searches.get(key, () => search(q, filters))));
});

// Pasted links: videos parse directly; handles and custom URLs (/@name, /c/name, /user/name) resolve to a channel id.
const resolved = new SharedCache<{ channelId: string } | null>("resolve");

/** "1h2m3s", "90", "1:30" → seconds. */
function parseTime(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d+(:\d{1,2}){1,2}$/.test(raw)) return raw.split(":").reduce((t, n) => t * 60 + Number(n), 0);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!m || !m[0]) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || undefined;
}

v1.get("/resolve", async (c) => {
  let url: URL;
  try {
    url = new URL(c.req.query("url") ?? "");
  } catch {
    throw fail(400, "Not a link.");
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const start = parseTime(url.searchParams.get("t") ?? url.searchParams.get("start") ?? new URLSearchParams(url.hash.slice(1)).get("t"));
  const video = (id: string | undefined): ResolvedLink | null => (id && /^[\w-]{11}$/.test(id) ? { type: "video", id, start } : null);
  let found: ResolvedLink | null = null;
  if (host === "youtu.be") found = video(parts[0]);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") found = video(url.searchParams.get("v") ?? undefined);
    else if (["shorts", "live", "embed", "v", "e"].includes(parts[0] ?? "")) found = video(parts[1]);
    else if (parts[0] === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) found = { type: "channel", id: parts[1]! };
    else if (parts[0]?.startsWith("@") || ((parts[0] === "c" || parts[0] === "user") && parts[1])) {
      const path = parts[0].startsWith("@") ? `/${parts[0]}` : `/${parts[0]}/${parts[1]}`;
      const hit = await resolved.get(path.toLowerCase(), async () => {
        const endpoint: { payload?: { browseId?: string } } | undefined = await (await yt()).resolveURL(`https://www.youtube.com${path}`).catch(() => undefined);
        const id = endpoint?.payload?.browseId;
        return id && /^UC[\w-]{22}$/.test(id) ? { channelId: id } : null;
      });
      if (hit) found = { type: "channel", id: hit.channelId };
    }
  }
  if (!found) throw fail(404, "Nothing on YouTube matches that link.", "not_found");
  return c.json(found);
});

// ---------------------------------------------------------------------------
// Actions as an account (needs youtube.force-ssl)

function writable(ref: string): string {
  const row = db.prepare("SELECT scopes, needs_relink FROM accounts WHERE ref = ?").get(ref) as { scopes: string; needs_relink: number } | undefined;
  if (!row) throw fail(404, "Account not found.", "not_found");
  if (row.needs_relink) throw fail(409, "This account needs to be linked again.", "relink");
  if (!canWrite(row.scopes)) throw fail(403, "This account is read-only. Allow actions for it in Settings → Linked accounts.", "read_only");
  return ref;
}

v1.post("/actions/follow", async (c) => {
  const body = await c.req.json<{ account?: string; channelId?: string; on?: boolean }>();
  const ref = writable(accountParam(c, body));
  const channel = channelId(body.channelId);
  if (body.on) {
    const added = await upstream("subscription", async () => {
      try {
        return await subscribe(ref, channel);
      } catch (error) {
        if ((error as { reason?: string }).reason === "subscriptionDuplicate") return undefined;
        throw error;
      }
    });
    db.prepare("INSERT OR IGNORE INTO subscriptions (account_ref, channel_id, title, avatar) VALUES (?, ?, ?, ?)").run(ref, channel, added?.title ?? channel, added?.avatar ?? null);
  } else {
    await upstream("subscription", () => unsubscribe(ref, channel));
    db.prepare("DELETE FROM subscriptions WHERE account_ref = ? AND channel_id = ?").run(ref, channel);
  }
  return c.json({ ok: true });
});

// Each lookup costs quota; keep the answer (and replace it whenever the account rates).
const ratings = new SharedCache<Rating>("rating");

v1.get("/actions/rating", async (c) => {
  const ref = writable(accountParam(c));
  const id = videoId(c.req.query("video"));
  return c.json({ rating: await upstream("your rating", () => ratings.get(`${ref}:${id}`, () => getRating(ref, id))) });
});

v1.post("/actions/rating", async (c) => {
  const body = await c.req.json<{ account?: string; videoId?: string; rating?: Rating }>();
  const ref = writable(accountParam(c, body));
  if (!["like", "dislike", "none"].includes(body.rating ?? "")) throw fail(400, "Invalid rating.");
  const id = videoId(body.videoId);
  await upstream("rating", () => rate(ref, id, body.rating!));
  await ratings.setMany([[`${ref}:${id}`, body.rating!]]);
  return c.json({ ok: true });
});

v1.post("/actions/comments", async (c) => {
  const body = await c.req.json<{ account?: string; videoId?: string; text?: string; parentId?: string }>();
  const ref = writable(accountParam(c, body));
  const text = body.text?.trim() ?? "";
  if (!text) throw fail(422, "Write something first.");
  if (text.length > 10_000) throw fail(422, "Comments can be at most 10,000 characters.");
  if (body.parentId !== undefined && (typeof body.parentId !== "string" || !/^[\w.-]{10,100}$/.test(body.parentId))) throw fail(400, "Invalid reply target.");
  const posted = await upstream("comment", () => postComment(ref, videoId(body.videoId), text, body.parentId));
  const comment: Comment = {
    id: posted.id,
    author: posted.snippet.authorDisplayName,
    avatar: proxyImage(posted.snippet.authorProfileImageUrl),
    text: posted.snippet.textOriginal ?? text,
    likes: 0,
    publishedText: "just now",
    replyCount: 0,
  };
  return c.json(comment);
});

v1.post("/actions/progress", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// Owner settings: signed-in playback for age-restricted videos

v1.get("/admin/age-restricted", async (c) => c.json(await signedInState()));
v1.get("/admin/age-restricted/settings", (c) => c.json(getSettings()));
v1.put("/admin/age-restricted/settings", async (c) => {
  const body = await c.req.json<{ botCheckFallback?: unknown }>();
  if (typeof body.botCheckFallback === "boolean") setSetting("botCheckFallback", body.botCheckFallback);
  return c.json(getSettings());
});
v1.post("/admin/age-restricted/start", async (c) => c.json(await startSignedIn()));
v1.post("/admin/age-restricted/sign-out", async (c) => {
  signOutSignedIn();
  return c.json(await signedInState());
});

// Bring back signed-in playback for age-restricted videos if it was set up before.
resumeSignedIn();
service.start();
