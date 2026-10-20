import { fileURLToPath } from "node:url";
import type { BackendInfo, ChannelPage, LinkRequest, Video, VideoDetail } from "@tube/shared";
import { accountParam, createService, fail, type ServiceEnv } from "../../kit/src/service.ts";
import type { Context } from "hono";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { begin, poll, accountView } from "./auth.ts";
import { account, forgetServers, json, request, serverFor, servers } from "./client.ts";
import { libraryChannel, showChannel, movieChannel, video } from "./catalog.ts";
import { itemId, parseId } from "./ids.ts";
import { mediaRoutes, playback } from "./playback.ts";
import type { Server } from "./types.ts";
const info = (): BackendInfo => ({
 protocol: 1, kind: "plex", name: "Plex", color: "#e5a00d",
 nouns: { channel: "library or show", channels: "libraries and shows", video: "movie or episode", videos: "movies and episodes", follow: "In your library", following: "In your library" },
 link: { method: "redirect", configured: true, can: ["Browse movies and TV on your accessible Plex servers", "Play media through your Plex server", "Sync playback progress to Plex"], cannot: ["See your Plex password", "Manage billing or server settings", "Access libraries that have not been shared with you"], requirement: "Your Plex Media Server must be reachable from Fanoos. Plex playback and subscription requirements still apply." },
 features: ["feed", "search", "progress", "segments", "movies"], linkHosts: ["app.plex.tv"],
 urls: { video: "", channel: "" }, private: false,
});
function refs(c: Context<ServiceEnv>) { const value = c.get("accounts"); if (!value.length) throw fail(409, "Connect a Plex account to browse your libraries.", "no_account"); return value; }
async function targets(accounts: string[]) { return (await Promise.all(accounts.map(async (ref) => (await servers(ref)).map((server) => ({ ref, server }))))).flat(); }
async function target(accounts: string[], id: string) {
 for (const ref of accounts) { if ((await servers(ref)).some((s) => s.id === id)) return { ref, server: await serverFor(ref, id) }; }
 throw fail(503, "This Plex server is not reachable or is not shared with your account.", "upstream");
}
function merge<T extends { id: string; via?: string[] }>(items: T[]): T[] {
 const result = new Map<string, T>();
 for (const item of items) { const old = result.get(item.id); result.set(item.id, old ? { ...old, via: [...new Set([...(old.via || []), ...(item.via || [])])] } : item); }
 return [...result.values()];
}
function offset(value?: string) { if (!value) return 0; if (!/^\d{1,7}$/.test(value)) throw fail(400, "Invalid library page."); return Number(value); }
function pageQuery(start: number, extra: Record<string, string> = {}) { return new URLSearchParams({ "X-Plex-Container-Start": String(start), "X-Plex-Container-Size": "50", ...extra }); }
async function detail(ref: string, server: Server, key: string): Promise<VideoDetail> {
 const data = (await json(server, `/library/metadata/${key}?includeChapters=1&includeMarkers=1`)).MediaContainer;
 const item = data.Metadata?.[0]; if (!item || !["movie", "episode"].includes(item.type)) throw fail(404, "This Plex item is not a movie or episode.", "not_found");
 const result = video(ref, server, { ...item, librarySectionID: item.librarySectionID ?? data.librarySectionID, librarySectionTitle: item.librarySectionTitle ?? data.librarySectionTitle });
 let channel; let next: Video[] = [];
 if (item.type === "episode" && item.grandparentRatingKey) {
  const show = (await json(server, `/library/metadata/${item.grandparentRatingKey}`)).MediaContainer.Metadata?.[0];
  if (!show) throw fail(404, "Plex show not found.", "not_found"); channel = showChannel(ref, server, show);
  if (item.parentRatingKey) { const siblings = (await json(server, `/library/metadata/${item.parentRatingKey}/children?${pageQuery(Math.max(0, (item.index ?? 1) - 1))}`)).MediaContainer.Metadata ?? []; next = siblings.filter((v) => (v.index ?? 0) > (item.index ?? 0)).map((v) => video(ref, server, v)); }
 } else {
  channel = movieChannel(ref, server, item);
 }
 return { video: result, channel, next, stream: playback(ref, server, item) };
}
export function createPlexService() {
 const service = createService(config, info); const { v1, pub } = service;
 pub.route("/", mediaRoutes);
 v1.post("/links", async (c) => c.json(await begin(await c.req.json<LinkRequest>())));
 v1.get("/links/:flow", async (c) => c.json(await poll(c.req.param("flow"))));
 v1.get("/accounts/:ref", (c) => c.json(accountView(c.req.param("ref"))));
 v1.delete("/accounts/:ref", (c) => { const ref = c.req.param("ref"); account(ref, true); db.prepare("DELETE FROM accounts WHERE ref = ?").run(ref); forgetServers(ref); return c.json({ ok: true }); });
 v1.get("/following", async (c) => {
  const rows = await Promise.all((await targets(refs(c))).map(async ({ ref, server }) => ((await json(server, "/library/sections")).MediaContainer.Directory ?? []).filter((l) => ["movie", "show"].includes(l.type)).map((l) => libraryChannel(ref, server, l))));
  return c.json(merge(rows.flat()));
 });
 v1.get("/feed", async (c) => {
  const selectedLibrary = c.req.query("library");
  if (selectedLibrary && !parseId(selectedLibrary).library) throw fail(400, "Choose a Plex library.");
  const rows = await Promise.all((await targets(refs(c))).map(async ({ ref, server }) => {
   const libraries = ((await json(server, "/library/sections")).MediaContainer.Directory ?? []).filter((l) => ["movie", "show"].includes(l.type) && (!selectedLibrary || itemId(server.id, l.key, true) === selectedLibrary));
   return (await Promise.all(libraries.map(async (library) => ((await json(server, `/library/sections/${library.key}/all?${pageQuery(0, { type: library.type === "movie" ? "1" : "4", sort: "addedAt:desc" })}`)).MediaContainer.Metadata ?? []).map((item) => video(ref, server, { ...item, librarySectionTitle: library.title }, library.key))))).flat();
  }));
  return c.json(merge(rows.flat()).sort((a, b) => (b.addedAt ?? b.published).localeCompare(a.addedAt ?? a.published)).slice(0, 200));
 });
 v1.get("/continue", async (c) => c.json(merge((await Promise.all((await targets(refs(c))).map(async ({ ref, server }) => ((await json(server, "/library/onDeck")).MediaContainer.Metadata ?? []).filter((v) => (v.viewOffset ?? 0) > 0).map((v) => video(ref, server, v))))).flat())));
 v1.get("/calendar", (c) => c.json([]));
 v1.get("/playlists", (c) => c.json([]));
 v1.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200); if (!q) return c.json({ channels: [], videos: [] });
  const found = await Promise.all((await targets(refs(c))).map(async ({ ref, server }) => {
   const data = (await json(server, `/hubs/search?${new URLSearchParams({ query: q, limit: "30" })}`)).MediaContainer;
   const items = [...(data.Metadata ?? []), ...(data.Hub ?? []).flatMap((h) => h.Metadata ?? [])];
   return { channels: items.filter((i) => i.type === "show").map((i) => showChannel(ref, server, i)), videos: items.filter((i) => ["episode", "movie"].includes(i.type)).map((i) => video(ref, server, i)) };
  }));
  const type = c.req.query("type");
  return c.json({ channels: type === "video" ? [] : merge(found.flatMap((r) => r.channels)), videos: type === "channel" ? [] : merge(found.flatMap((r) => r.videos)) });
 });
 v1.get("/channels/:id", async (c) => {
  const id = parseId(c.req.param("id")); const { ref, server } = await target(refs(c), id.server); const start = offset(c.req.query("next")); const q = (c.req.query("q") || "").slice(0, 200);
  let page: ChannelPage;
  if (id.library) {
   const library = ((await json(server, "/library/sections")).MediaContainer.Directory ?? []).find((l) => l.key === id.key && ["movie", "show"].includes(l.type));
   if (!library) throw fail(404, "Plex library not found.", "not_found");
   const data = (await json(server, `/library/sections/${id.key}/all?${pageQuery(start, { sort: "titleSort:asc", ...(q ? { title: q } : {}) })}`)).MediaContainer;
   const items = data.Metadata ?? []; page = { channel: libraryChannel(ref, server, library), videos: library.type === "movie" ? items.filter((i) => i.type === "movie").map((i) => video(ref, server, { ...i, librarySectionTitle: library.title }, library.key)) : [], channels: library.type === "show" ? items.filter((i) => i.type === "show").map((i) => showChannel(ref, server, i)) : undefined, next: start + items.length < (data.totalSize ?? items.length) ? String(start + items.length) : undefined };
  } else {
   const show = (await json(server, `/library/metadata/${id.key}`)).MediaContainer.Metadata?.[0]; if (show?.type === "movie") return c.json({ channel: movieChannel(ref, server, show), videos: [video(ref, server, show)] });
   if (!show || show.type !== "show") throw fail(404, "Plex show not found.", "not_found");
   const seasons = (await json(server, `/library/metadata/${id.key}/children`)).MediaContainer.Metadata ?? [];
   const sections = seasons.filter((s) => s.type === "season").map((s) => ({ id: itemId(server.id, s.ratingKey), label: s.title, count: s.leafCount }));
   const selected = c.req.query("section") || sections[0]?.id; const season = selected && sections.find((s) => s.id === selected); if (selected && !season) throw fail(400, "Choose a season of this show.");
   const data = season ? (await json(server, `/library/metadata/${parseId(season.id).key}/children?${pageQuery(start)}`)).MediaContainer : { Metadata: [] };
   const items = data.Metadata ?? [];
   page = { channel: showChannel(ref, server, show), sections, section: selected, videos: items.map((i) => video(ref, server, i)), next: start + items.length < (data.totalSize ?? items.length) ? String(start + items.length) : undefined };
  }
  return c.json(page);
 });
 v1.get("/channels/:id/about", async (c) => {
  const id = parseId(c.req.param("id")); const { server } = await target(refs(c), id.server);
  return c.json({ description: id.library ? "A library on your Plex Media Server." : (await json(server, `/library/metadata/${id.key}`)).MediaContainer.Metadata?.[0]?.summary || "" });
 });
 v1.get("/channels/:id/followers", (c) => c.json(c.get("accounts")));
 v1.get("/videos/:id", async (c) => { const id = parseId(c.req.param("id")); if (id.library) throw fail(400, "Choose a movie or episode."); const { ref, server } = await target(refs(c), id.server); return c.json(await detail(ref, server, id.key)); });
 v1.get("/videos", async (c) => {
  const ids = (c.req.query("ids") || "").split(",").filter(Boolean).slice(0, 50);
  return c.json(await Promise.all(ids.map(async (value) => { const id = parseId(value); const { ref, server } = await target(refs(c), id.server); const item = (await json(server, `/library/metadata/${id.key}`)).MediaContainer.Metadata?.[0]; if (!item) throw fail(404, "Plex item not found."); return video(ref, server, item); })));
 });
 v1.post("/actions/progress", async (c) => {
  const body = await c.req.json<{ account: string; videoId: string; position: number }>(); const ref = accountParam(c, body); const id = parseId(body.videoId);
  if (!Number.isFinite(body.position) || body.position < 0 || id.library) throw fail(400, "Invalid playback position.");
  const server = await serverFor(ref, id.server); const item = (await json(server, `/library/metadata/${id.key}`)).MediaContainer.Metadata?.[0];
  const query = new URLSearchParams({ ratingKey: id.key, key: `/library/metadata/${id.key}`, state: "playing", time: String(Math.round(body.position * 1000)), duration: String(item?.duration ?? 0) });
  const res = await request(server, `/:/timeline?${query}`, { method: "POST" }); if (!res.ok) throw fail(502, "Plex could not save playback progress."); return c.json({ ok: true });
 });
 v1.get("/resolve", async (c) => {
  const url = new URL(c.req.query("url") || ""); if (url.protocol !== "https:" || url.hostname !== "app.plex.tv") throw fail(400, "Use a Plex web link.");
  const match = /\/server\/([a-fA-F0-9-]{8,48})\//.exec(url.hash); const query = new URLSearchParams(url.hash.split("?")[1] || ""); const key = /^\/library\/metadata\/(\d+)$/.exec(query.get("key") || "");
  if (!match || !key) throw fail(400, "Use a link to a Plex movie, episode, or show.");
  const { server } = await target(refs(c), match[1]!);
  const item = (await json(server, `/library/metadata/${key[1]}`)).MediaContainer.Metadata?.[0];
  if (!item) throw fail(404, "Plex item not found.");
  return c.json({ type: item.type === "show" || item.type === "season" || item.type === "movie" ? "channel" : "video", id: itemId(match[1]!, item.type === "season" ? item.parentRatingKey || key[1]! : key[1]!) });
 });
 return service;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createPlexService().start();
