/*
 * Content across every backend. Lists the viewer follows (following, feed, continue watching)
 * merge the results of each backend for the accounts linked through it; single items route to
 * the backend named in the URL (/api/v/<slug>/…). No provider-specific code lives here.
 */
import { Hono } from "hono";
import type { BackendFeature, Channel, ChannelAbout, ChannelPage, Comment, CommentPage, Playlist, ResolvedLink, SearchResults, Video, VideoDetail } from "@tube/shared";
import { accountById, accountsFor, BackendError, bySlug, call, type CoreAccount, infoOf, noteRelink, relay, serviceBySlug, services, viaToIds } from "../backends.ts";
import { db } from "../db.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";

export const contentRoutes = new Hono<AppEnv>();
contentRoutes.use("*", requireUser);

const has = (slug: string, feature: BackendFeature) => infoOf(slug)?.features.includes(feature) ?? false;

/** Run `work` per backend (with that backend's accounts); a failing backend is reported, not fatal. */
async function each<T>(
  accounts: CoreAccount[],
  work: (slug: string, list: CoreAccount[]) => Promise<T[]>,
): Promise<{ items: T[]; failed: { backend: string; error: string; code?: string }[] }> {
  const groups = [...bySlug(accounts)];
  const failed: { backend: string; error: string; code?: string }[] = [];
  const results = await Promise.all(
    groups.map(async ([slug, list]) => {
      try {
        return await work(slug, list);
      } catch (error) {
        const e = error as BackendError;
        console.warn(`${slug}: ${e.message}`);
        failed.push({ backend: slug, error: e.message, code: e.code });
        return [];
      }
    }),
  );
  return { items: results.flat(), failed };
}

/** The viewer's own grouping (Tech, Music…) for channels, keyed "<slug>:<id>". */
function groupsOf(userId: string): Map<string, string> {
  const rows = db.prepare("SELECT channel_id, grp FROM channel_groups WHERE user_id = ?").all(userId) as { channel_id: string; grp: string }[];
  return new Map(rows.map((r) => [r.channel_id, r.grp]));
}

const refsOf = (list: CoreAccount[]) => list.map((a) => a.ref);

contentRoutes.get("/following", async (c) => {
  const user = c.get("user");
  const groups = groupsOf(user.id);
  const { items, failed } = await each(accountsFor(user.id, { feed: true }), async (slug, list) =>
    viaToIds(await call<Channel[]>(slug, "/following", { accounts: refsOf(list) }), list, slug).map((ch) => ({ ...ch, group: groups.get(`${slug}:${ch.id}`) })),
  );
  if (failed.length) c.header("x-fanoos-partial", failed.map((f) => f.backend).join(","));
  return c.json(items.sort((a, b) => a.name.localeCompare(b.name)));
});

contentRoutes.get("/feed", async (c) => {
  const user = c.get("user");
  const group = c.req.query("group") || undefined;
  const only = c.req.query("account") || undefined;
  const backend = c.req.query("backend") || undefined;
  const groups = groupsOf(user.id);
  const accounts = accountsFor(user.id, { feed: true }).filter((a) => (!only || a.id === only) && (!backend || a.slug === backend));
  const { items, failed } = await each(accounts, async (slug, list) =>
    has(slug, "feed") ? viaToIds(await call<Video[]>(slug, "/feed", { accounts: refsOf(list) }), list, slug) : [],
  );
  if (failed.length) c.header("x-fanoos-partial", failed.map((f) => f.backend).join(","));
  const videos = items.filter((v) => !group || groups.get(`${v.backend}:${v.channelId}`) === group);
  return c.json(videos.sort((a, b) => b.published.localeCompare(a.published)));
});

/** What followed channels and shows released in [from, to), oldest first (the Calendar). */
contentRoutes.get("/calendar", async (c) => {
  const user = c.get("user");
  const backend = c.req.query("backend") || undefined;
  const range = { from: c.req.query("from"), to: c.req.query("to") };
  if (!range.from || !range.to || !(Date.parse(range.from) < Date.parse(range.to))) throw fail(400, "Pick a date range.");
  if (Date.parse(range.to) - Date.parse(range.from) > 70 * 864e5) throw fail(400, "Pick a range of up to 70 days.");
  const accounts = accountsFor(user.id, { feed: true }).filter((a) => !backend || a.slug === backend);
  const { items, failed } = await each(accounts, async (slug, list) =>
    has(slug, "calendar") ? viaToIds(await call<Video[]>(slug, "/calendar", { accounts: refsOf(list), query: range }), list, slug) : [],
  );
  if (failed.length) c.header("x-fanoos-partial", failed.map((f) => f.backend).join(","));
  return c.json(items.sort((a, b) => a.published.localeCompare(b.published)));
});

/** Progress the services track themselves (YouTube's lives in the Fanoos account instead). */
contentRoutes.get("/continue", async (c) => {
  const user = c.get("user");
  const { items } = await each(accountsFor(user.id), async (slug, list) =>
    has(slug, "progress") ? viaToIds(await call<Video[]>(slug, "/continue", { accounts: refsOf(list) }), list, slug) : [],
  );
  return c.json(items);
});

/** Search every backend that can (or one: ?backend=). Backends without a linked account that need one return nothing. */
contentRoutes.get("/search", async (c) => {
  const user = c.get("user");
  const only = c.req.query("backend") || undefined;
  const query = {
    q: (c.req.query("q") ?? "").trim().slice(0, 200),
    type: c.req.query("type"),
    duration: c.req.query("duration"),
    uploaded: c.req.query("uploaded"),
    sort: c.req.query("sort"),
  };
  if (!query.q) return c.json([]);
  const accounts = accountsFor(user.id);
  const sections = await Promise.all(
    services
      .filter((s) => (!only || s.slug === only) && has(s.slug, "search"))
      .map(async (s) => {
        const list = accounts.filter((a) => a.slug === s.slug);
        try {
          const r = await call<SearchResults>(s.slug, "/search", { accounts: refsOf(list), query });
          return { backend: s.slug, channels: viaToIds(r.channels, list, s.slug), videos: viaToIds(r.videos, list, s.slug), next: r.next };
        } catch (error) {
          return { backend: s.slug, channels: [], videos: [], error: (error as Error).message };
        }
      }),
  );
  return c.json(sections);
});

contentRoutes.get("/playlists", async (c) => {
  const user = c.get("user");
  const { items } = await each(accountsFor(user.id), async (slug, list) => {
    if (!has(slug, "playlists")) return [];
    const ids = new Map(list.map((a) => [a.ref, a.id]));
    return (await call<Playlist[]>(slug, "/playlists", { accounts: refsOf(list) })).map((p) => ({ ...p, backend: slug, accountId: ids.get(p.accountId) ?? p.accountId }));
  });
  return c.json(items);
});

/** A pasted link: the backend whose hosts it matches says what it points to. */
contentRoutes.get("/resolve", async (c) => {
  let url: URL;
  try {
    url = new URL(c.req.query("url") ?? "");
  } catch {
    throw fail(400, "Not a link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw fail(400, "Not a link.");
  const host = url.hostname.toLowerCase();
  const backend = services.find((s) => infoOf(s.slug)?.linkHosts.includes(host));
  if (!backend) throw fail(404, "No backend opens links from that site.", "not_found");
  const found = await call<ResolvedLink>(backend.slug, "/resolve", { query: { url: url.toString() } }).catch(relay);
  return c.json({ ...found, backend: backend.slug });
});

// ---------------------------------------------------------------------------
// Items on one backend: /api/v/<slug>/…

const item = new Hono<AppEnv>();

const slugOf = (raw: string | undefined) => {
  if (!raw || !serviceBySlug(raw)) throw fail(404, "No such backend.", "not_found");
  return raw;
};
const safeId = (raw: string | undefined) => {
  if (!raw || !/^[\w.-]{1,64}$/.test(raw)) throw fail(400, "Invalid id.");
  return raw;
};

/** The viewer's accounts on this backend (for following filters and acting as the account). */
const mine = (userId: string, slug: string) => accountsFor(userId, { slug });

item.get("/videos/:id", async (c) => {
  const slug = slugOf(c.req.param("slug"));
  const list = mine(c.get("user").id, slug);
  const detail = await call<VideoDetail>(slug, `/videos/${safeId(c.req.param("id"))}`, { accounts: refsOf(list) }).catch(relay);
  const [video] = viaToIds([detail.video], list, slug);
  const [channel] = viaToIds([detail.channel], list, slug);
  return c.json({ ...detail, video: video!, channel: channel!, next: viaToIds(detail.next, list, slug) } satisfies VideoDetail);
});

item.get("/videos", async (c) => {
  const slug = slugOf(c.req.param("slug"));
  const list = mine(c.get("user").id, slug);
  const ids = (c.req.query("ids") ?? "").split(",").filter((id) => /^[\w.-]{1,64}$/.test(id)).slice(0, 50);
  if (!ids.length) return c.json([]);
  return c.json(viaToIds(await call<Video[]>(slug, "/videos", { accounts: refsOf(list), query: { ids: ids.join(",") } }).catch(relay), list, slug));
});

item.get("/videos/:id/comments", async (c) => {
  const slug = slugOf(c.req.param("slug"));
  if (!has(slug, "comments")) return c.json({ comments: [] } satisfies CommentPage);
  return c.json(
    await call<CommentPage>(slug, `/videos/${safeId(c.req.param("id"))}/comments`, { query: { sort: c.req.query("sort"), next: c.req.query("next") } }).catch(relay),
  );
});

item.get("/comments/replies", async (c) =>
  c.json(await call<CommentPage>(slugOf(c.req.param("slug")), "/comments/replies", { query: { token: c.req.query("token") } }).catch(relay)),
);

item.get("/channels/:id", async (c) => {
  const slug = slugOf(c.req.param("slug"));
  const list = mine(c.get("user").id, slug);
  const id = safeId(c.req.param("id"));
  const page = await call<ChannelPage>(slug, `/channels/${id}`, { accounts: refsOf(list), query: { section: c.req.query("section"), next: c.req.query("next"), q: c.req.query("q"), sort: c.req.query("sort") } }).catch(relay);
  const group = groupsOf(c.get("user").id).get(`${slug}:${id}`);
  const [channel] = viaToIds([{ ...page.channel, group }], list, slug);
  return c.json({ ...page, channel: channel!, videos: viaToIds(page.videos, list, slug) } satisfies ChannelPage);
});

/** Full description, rather than the abbreviated channel browse metadata. */
item.get("/channels/:id/about", async (c) => {
  const slug = slugOf(c.req.param("slug"));
  const id = safeId(c.req.param("id"));
  const list = mine(c.get("user").id, slug);
  return c.json(await call<ChannelAbout>(slug, `/channels/${id}/about`, { accounts: refsOf(list) }).catch(relay));
});

/** Which of the viewer's accounts follow this channel or show. */
item.get("/channels/:id/followers", async (c) => {
  const slug = slugOf(c.req.param("slug"));
  const list = mine(c.get("user").id, slug);
  if (!list.length) return c.json([]);
  const refs = await call<string[]>(slug, `/channels/${safeId(c.req.param("id"))}/followers`, { accounts: refsOf(list) }).catch(relay);
  const ids = new Map(list.map((a) => [a.ref, a.id]));
  return c.json(refs.map((r) => ids.get(r)).filter(Boolean));
});

item.put("/channels/:id/group", async (c) => {
  const slug = slugOf(c.req.param("slug"));
  const key = `${slug}:${safeId(c.req.param("id"))}`;
  const { group } = await c.req.json<{ group?: string | null }>();
  if (group?.trim()) db.prepare("INSERT OR REPLACE INTO channel_groups (user_id, channel_id, grp) VALUES (?, ?, ?)").run(c.get("user").id, key, group.trim().slice(0, 40));
  else db.prepare("DELETE FROM channel_groups WHERE user_id = ? AND channel_id = ?").run(c.get("user").id, key);
  return c.json({ ok: true });
});

contentRoutes.route("/v/:slug", item);

// ---------------------------------------------------------------------------
// Acting as one linked account: the account decides the backend.

const act = new Hono<AppEnv>();

async function asAccount<T>(userId: string, accountId: unknown, work: (a: CoreAccount) => Promise<T>): Promise<T> {
  const account = accountById(userId, accountId);
  try {
    return await work(account);
  } catch (error) {
    noteRelink(account.id, error);
    return relay(error);
  }
}

act.post("/follow", async (c) => {
  const body = await c.req.json<{ accountId?: string; channelId?: string; on?: boolean }>();
  return c.json(await asAccount(c.get("user").id, body.accountId, (a) => call(a.slug, "/actions/follow", { body: { account: a.ref, channelId: body.channelId, on: body.on } })));
});

act.get("/rating", async (c) =>
  c.json(await asAccount(c.get("user").id, c.req.query("accountId"), (a) => call(a.slug, "/actions/rating", { query: { account: a.ref, video: c.req.query("videoId") } }))),
);

act.post("/rating", async (c) => {
  const body = await c.req.json<{ accountId?: string; videoId?: string; rating?: string }>();
  return c.json(await asAccount(c.get("user").id, body.accountId, (a) => call(a.slug, "/actions/rating", { body: { account: a.ref, videoId: body.videoId, rating: body.rating } })));
});

act.post("/comments", async (c) => {
  const body = await c.req.json<{ accountId?: string; videoId?: string; text?: string; parentId?: string }>();
  return c.json(
    await asAccount(c.get("user").id, body.accountId, (a) =>
      call<Comment>(a.slug, "/actions/comments", { body: { account: a.ref, videoId: body.videoId, text: body.text, parentId: body.parentId } }),
    ),
  );
});

/** Report a playback position to services that track progress (fire-and-forget from the player). */
act.post("/progress", async (c) => {
  const body = await c.req.json<{ backend?: string; videoId?: string; position?: number; accountId?: string }>();
  const slug = slugOf(body.backend);
  if (!has(slug, "progress")) return c.json({ ok: true });
  const account = body.accountId ? accountById(c.get("user").id, body.accountId) : mine(c.get("user").id, slug)[0];
  if (!account) return c.json({ ok: true });
  await call(slug, "/actions/progress", { body: { account: account.ref, videoId: body.videoId, position: body.position } }).catch(() => {});
  return c.json({ ok: true });
});

contentRoutes.route("/actions", act);
