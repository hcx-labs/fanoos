import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "fanoos-plex-test-"));
process.env.DATA_DIR = directory; process.env.BACKEND_TOKEN = "test-backend-secret"; process.env.PUBLIC_URL = "http://localhost:5180"; process.env.REDIS_URL = "";
const A = "a".repeat(40), B = "b".repeat(40);
const requests: { url: URL; headers: Headers; method: string }[] = [];
const realFetch = globalThis.fetch;
let linked = false; let resourceFailure = false;
const movie = { ratingKey: "4", title: "Test Movie", type: "movie", librarySectionID: 10, librarySectionTitle: "Movies", duration: 120000, originallyAvailableAt: "2001-12-19", year: 2001, addedAt: 12345, thumb: "/library/metadata/4/thumb/1", Media: [{ width: 1920, height: 1080, videoResolution: "1080", bitrate: 12000, container: "mp4", videoCodec: "h264", audioCodec: "aac", Part: [{ id: 44, key: "/library/parts/44/file.mp4", Stream: [] }] }] };
const show = { ratingKey: "1", type: "show", title: "Test Show", leafCount: 1, thumb: "/library/metadata/1/thumb/1" };
const season = { ratingKey: "2", type: "season", title: "Season 1", parentRatingKey: "1", leafCount: 1 };
const episode = { ratingKey: "3", type: "episode", title: "Test Episode", parentRatingKey: "2", parentTitle: "Season 1", parentIndex: 1, grandparentRatingKey: "1", grandparentTitle: "Test Show", index: 1, duration: 60000, viewOffset: 5000, Media: [{ width: 1920, height: 1080, videoResolution: "1080", bitrate: 14000, container: "mkv", videoCodec: "hevc", audioCodec: "dca", Part: [{ id: 33, key: "/library/parts/33/file.mkv", Stream: [{ id: 8, streamType: 2, languageCode: "ja", displayTitle: "Japanese", selected: true }, { id: 9, streamType: 2, languageCode: "en", displayTitle: "English" }, { id: 7, streamType: 3, codec: "srt", language: "English", languageCode: "en" }, { id: 10, streamType: 3, codec: "srt", key: "/library/streams/10", languageCode: "en", displayTitle: "English (external)" }, { id: 11, streamType: 3, codec: "pgs", languageCode: "en", displayTitle: "English (PGS)" }] }] }] };
const container = (data: object) => Response.json({ MediaContainer: data });
globalThis.fetch = async (input, init) => {
 const url = new URL(String(input)); const headers = new Headers(init?.headers); requests.push({ url, headers, method: init?.method || "GET" });
 if (url.hostname === "plex.tv") {
  if (url.pathname === "/api/v2/pins" && init?.method === "POST") return Response.json({ id: 123, code: "pin-code", expiresIn: 600 });
  if (url.pathname === "/api/v2/pins/123") return Response.json({ authToken: linked ? "private-account-token" : null });
  if (url.pathname === "/api/v2/user") return Response.json({ id: 1, username: "Plex Tester" });
  if (url.pathname === "/api/v2/resources") return resourceFailure ? new Response(null, { status: 401 }) : Response.json([A, B].map((id, i) => ({ clientIdentifier: id, name: i ? "Shared Server" : "My Server", provides: "server", owned: !i, accessToken: `private-server-token-${id}`, connections: [{ uri: `https://${id}.plex.direct:32400`, local: !i, relay: false }] })));
 }
 const id = url.hostname.split(".")[0]; assert.ok([A, B].includes(id));
 assert.equal(headers.get("x-plex-token"), `private-server-token-${id}`);
 if (url.pathname === "/identity") return container({ machineIdentifier: id });
 if (url.pathname === "/library/sections") return container({ Directory: [{ key: "10", title: "Movies", type: "movie" }, { key: "20", title: "TV", type: "show" }] });
 if (url.pathname === "/library/sections/10/all") return container({ Metadata: [movie], totalSize: 1 });
 if (url.pathname === "/library/sections/20/all") return container({ Metadata: url.searchParams.get("type") === "4" ? [episode] : [show], totalSize: 51 });
 if (url.pathname === "/library/metadata/1") return container({ Metadata: [show] });
 if (url.pathname === "/library/metadata/1/children") return container({ Metadata: [season] });
 if (url.pathname === "/library/metadata/2/children") return container({ Metadata: [episode] });
 if (url.pathname === "/library/metadata/3") return container({ Metadata: [episode] });
 if (url.pathname === "/library/metadata/4") return container({ Metadata: [movie], librarySectionID: 10 });
 if (url.pathname === "/library/onDeck") return container({ Metadata: [episode] });
 if (url.pathname === "/hubs/search") return container({ Hub: [{ Metadata: [show, episode, movie] }] });
 if (url.pathname === "/video/:/transcode/universal/start.mpd") {
  const sid = url.searchParams.get("session");
  return new Response(`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><BaseURL>/video/:/transcode/universal/session/${sid}/dash/?X-Plex-Token=must-not-leak</BaseURL><Period><AdaptationSet><Representation id="0"><SegmentTemplate initialization="init.mp4" media="chunk-$Number$.m4s" /></Representation></AdaptationSet></Period></MPD>`, { headers: { "content-type": "application/dash+xml" } });
 }
 if (url.pathname.includes("/chunk-1.m4s")) return new Response("segment", { headers: { "content-type": "video/mp4" } });
 if (url.pathname === "/library/parts/33" && init?.method === "PUT") return new Response(null, { status: 200 });
 if (url.pathname === "/library/parts/44/file.mp4") return new Response("part", { status: 206, headers: { "content-range": "bytes 0-3/4", "content-type": "video/mp4" } });
 if (url.pathname === "/library/streams/10") return new Response("WEBVTT\n\n00:00.000 --> 00:03.000\nHello Fanoos\n", { headers: { "content-type": "text/vtt" } });
 if (url.pathname === "/:/timeline" || url.pathname.endsWith("/ping") || url.pathname.endsWith("/stop")) return new Response(null, { status: 200 });
 throw Error(`Unexpected fixture path ${url.pathname}`);
};
const { createPlexService } = await import("./index.ts");
const { db } = await import("./db.ts");
const { forgetServers } = await import("./client.ts");
const { rewriteManifest } = await import("./manifest.ts");
const service = createPlexService(); service.app.route("/v1", service.v1); service.app.route("/public", service.pub);
const api = (path: string, options: RequestInit = {}) => service.app.request(`/v1${path}`, { ...options, headers: { authorization: "Bearer test-backend-secret", "content-type": "application/json", ...options.headers } });
let ref: string;
test("Plex provider contract", async (t) => {
 t.after(() => { globalThis.fetch = realFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
 await t.test("protects core routes and advertises Plex without an application secret", async () => {
  assert.equal((await service.app.request("/v1/info")).status, 401);
  const info = await (await api("/info")).json(); assert.equal(info.kind, "plex"); assert.equal(info.link.method, "redirect");
 });
 await t.test("links through Plex PIN authentication and encrypts credentials", async () => {
  assert.equal((await api("/links", { method: "POST", body: JSON.stringify({ returnUrl: "https://attacker.test/api/links/complete" }) })).status, 400);
  const start = await (await api("/links", { method: "POST", body: JSON.stringify({ returnUrl: "http://localhost:5180/api/links/complete?f=test" }) })).json();
  assert.match(start.url, /^https:\/\/app.plex.tv\/auth#\?/);
  assert.equal((await (await api(`/links/${start.flow}`)).json()).status, "pending"); linked = true;
  const result = await (await api(`/links/${start.flow}`)).json(); ref = result.account.ref; assert.equal(result.status, "linked");
  assert.ok(!JSON.stringify(result).includes("private-account-token"));
  const stored = db.prepare("SELECT token FROM accounts WHERE ref = ?").get(ref)!; assert.notEqual(stored.token, "private-account-token");
 });
 await t.test("discovers owned/shared libraries with server-scoped IDs", async () => {
  const response = await api(`/following?accounts=${ref}`); const libraries = await response.json();
  assert.equal(libraries.length, 4); assert.notEqual(libraries[0].id, libraries[2].id);
  assert.ok(!JSON.stringify(libraries).includes("private-server-token"));
 });
 await t.test("shared catalog cache avoids repeat upstream reads while resume and playback stay fresh", async () => {
  const sections = () => requests.filter((r) => r.url.pathname === "/library/sections").length;
  const before = sections();
  await api(`/following?accounts=${ref}`); await api(`/following?accounts=${ref}`);
  assert.equal(sections(), before);
  const count = () => requests.filter((r) => r.url.pathname === "/library/metadata/4" && r.url.searchParams.has("includeChapters")).length;
  const first = count();
  await api(`/videos/${A}.m.4?accounts=${ref}`); await api(`/videos/${A}.m.4?accounts=${ref}`);
  assert.equal(count(), first + 2);
  const onDeck = () => requests.filter((r) => r.url.pathname === "/library/onDeck").length;
  const previous = onDeck();
  await api(`/continue?accounts=${ref}`); await api(`/continue?accounts=${ref}`);
  assert.equal(onDeck(), previous + 4);
 });
 await t.test("browses movies, shows, seasons and paginated libraries", async () => {
  const tv = await (await api(`/channels/${A}.l.20?accounts=${ref}`)).json(); assert.equal(tv.channels[0].kind, "series"); assert.equal(tv.next, "1");
  const series = await (await api(`/channels/${A}.m.1?accounts=${ref}`)).json(); assert.equal(series.sections.length, 1); assert.equal(series.videos[0].episode.number, "1");
  assert.equal((await api(`/channels/${A}.m.1?accounts=${ref}&section=${B}.m.2`)).status, 400);
  const movies = await (await api(`/channels/${A}.l.10?accounts=${ref}`)).json(); assert.equal(movies.videos[0].title, "Test Movie");
 });
 await t.test("movies have their own detail parent and release dates", async () => {
  const page = await (await api(`/channels/${A}.m.4?accounts=${ref}`)).json();
  assert.equal(page.channel.kind, "movie"); assert.equal(page.channel.name, "Test Movie");
  assert.equal(page.videos.length, 1); assert.equal(page.sections, undefined);
  assert.equal(page.videos[0].channelId, page.channel.id);
  assert.equal(page.videos[0].published, "2001-12-19T00:00:00.000Z");
  assert.notEqual(page.videos[0].addedAt, page.videos[0].published);
 });
 await t.test("embedded subtitles and selected audio get scoped playback routes", async () => {
  const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json();
  assert.equal(detail.stream.subtitles.length, 3);
  assert.equal(detail.stream.subtitles[0].render, undefined);
  assert.match(detail.stream.subtitles[0].url, /^\/public\/text-subtitle\//);
  assert.match(detail.stream.subtitles[1].url, /^\/public\/text-subtitle\//);
  assert.equal((await service.app.request(detail.stream.subtitles[0].url + "tampered")).status, 403);
  assert.deepEqual(detail.stream.audioTracks.map((track: { label: string }) => track.label), ["Japanese", "English"]);
  const track = detail.stream.audioTracks[1];
  assert.ok(track.sources.every((source: { stream: { dash?: string; progressive?: string } }) => source.stream.dash && !source.stream.progressive));
  assert.equal((await service.app.request(track.sources[0].stream.dash)).status, 200);
  assert.equal(requests.findLast((r) => r.url.pathname.endsWith("start.mpd"))?.url.searchParams.get("audioStreamID"), "9");
 });
 await t.test("prepares text subtitles asynchronously and reuses the shared cache", async () => {
  const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json();
  const url = detail.stream.subtitles[1].url;
  let response = await service.app.request(url);
  assert.equal(response.status, 202);
  for (let n = 0; n < 100 && response.status === 202; n++) {
   await new Promise((resolve) => setTimeout(resolve, 20)); response = await service.app.request(url);
  }
  assert.equal(response.status, 200); assert.match(await response.text(), /Hello Fanoos/);
  const reads = requests.filter((r) => r.url.pathname === "/library/streams/10").length;
  assert.equal((await service.app.request(url)).status, 200);
  assert.equal(requests.filter((r) => r.url.pathname === "/library/streams/10").length, reads);
 });
 await t.test("searches libraries and returns continue-watching progress", async () => {
  const search = await (await api(`/search?accounts=${ref}&q=Test`)).json(); assert.equal(search.channels.length, 2); assert.equal(search.videos.length, 4);
  const resumed = await (await api(`/continue?accounts=${ref}`)).json(); assert.equal(resumed[0].progress, 5);
 });
 await t.test("direct play preserves ranges and never exposes server credentials", async () => {
  const detail = await (await api(`/videos/${A}.m.4?accounts=${ref}`)).json(); assert.ok(detail.stream.progressive);
  const response = await service.app.request(detail.stream.progressive, { headers: { range: "bytes=0-3" } }); assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), "bytes 0-3/4");
  assert.equal(requests.at(-1)?.headers.get("range"), "bytes=0-3");
  assert.equal((await service.app.request(detail.stream.progressive + "tampered")).status, 403);
 });
 await t.test("proxies DASH templates, subtitles and session cleanup without tokens", async () => {
  const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json(); assert.ok(detail.stream.progressive); assert.equal(detail.stream.subtitles[0].format, "ass");
  const response = await service.app.request(detail.stream.sources.find((s: { id: string }) => s.id === "transcode-720").stream.dash, { headers: { "x-fanoos-base": "/api/b/plex" } }); assert.equal(response.status, 200); const xml = await response.text();
  assert.ok(!xml.includes("X-Plex-Token")); assert.ok(xml.includes("$Number$")); assert.match(xml, /\/api\/b\/plex\/public\/media\//);
  const media = /media="([^"]+)"/.exec(xml)![1]!.replace("$Number$", "1").replace(/&amp;/g, "&").replace("/api/b/plex", "");
  assert.equal(await (await service.app.request(media)).text(), "segment");
  assert.equal(detail.stream.subtitles[2].render, "server");
  const burned = await service.app.request(detail.stream.sources.find((s: { id: string }) => s.id === "transcode-720").stream.dash + "?subtitle=11"); assert.equal(burned.status, 200);
  assert.equal(requests.findLast((r) => r.url.pathname.endsWith("start.mpd"))?.url.searchParams.get("subtitles"), "burn");
  assert.ok(requests.some((r) => r.method === "PUT" && r.url.searchParams.get("subtitleStreamID") === "11"));
  assert.equal((await service.app.request(detail.stream.sources.find((s: { id: string }) => s.id === "transcode-720").stream.dash + "?subtitle=999")).status, 403);
  assert.equal((await service.app.request(detail.stream.sources.find((s: { id: string }) => s.id === "transcode-720").stream.session.release, { method: "POST" })).status, 200);
 });
 await t.test("feed library selection keeps episodes tied to their owning library", async () => {
  const feed = await (await api(`/feed?accounts=${ref}&library=${A}.l.20`)).json();
  assert.equal(feed.length, 1); assert.equal(feed[0].libraryId, `${A}.l.20`); assert.ok(feed[0].episode);
  assert.equal((await api(`/feed?accounts=${ref}&library=${A}.m.1`)).status, 400);
 });
 await t.test("quality sources distinguish original files from real transcoding targets", async () => {
  const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json();
  const original = detail.stream.sources.find((s: { id: string }) => s.id === "original");
  assert.ok(original.stream.progressive); assert.equal(detail.stream.defaultSource, "original");
  const transcode = detail.stream.sources.find((s: { id: string }) => s.id === "transcode-720");
  assert.equal(transcode.kind, "transcode"); assert.equal(transcode.bitrate, 4000000);
  await service.app.request(transcode.stream.dash);
  const start = requests.findLast((r) => r.url.pathname.endsWith("/start.mpd"))!;
  assert.equal(start.url.searchParams.get("directStream"), "0"); assert.equal(start.url.searchParams.get("videoBitrate"), "4000"); assert.equal(start.url.searchParams.get("videoResolution"), "1280x720");
  assert.equal(detail.stream.sources.some((s: { height: number }) => s.height > 1080), false);
 });
 await t.test("EAC3 stays original until the viewer explicitly chooses audio conversion", async () => {
  movie.Media[0].audioCodec = "eac3";
  try {
   const detail = await (await api(`/videos/${A}.m.4?accounts=${ref}`)).json();
   const original = detail.stream.sources.find((source: { id: string }) => source.id === "original");
   assert.equal(detail.stream.defaultSource, "original"); assert.ok(original.stream.progressive);
   assert.equal(detail.stream.originalAudio.codec, "eac3");
   assert.equal(detail.stream.originalAudio.mimeType, 'audio/mp4; codecs="ec-3"');
   const converted = detail.stream.audioTracks[0].sources.find((source: { id: string }) => source.id === "transcode-auto");
   assert.equal((await service.app.request(converted.stream.dash)).status, 200);
   const start = requests.findLast((r) => r.url.pathname.endsWith("start.mpd"))!.url;
   assert.equal(start.searchParams.get("directStream"), "1");
   assert.equal(start.searchParams.get("directStreamAudio"), "0");
   assert.equal(start.searchParams.get("audioChannelCount"), "2");
   assert.equal(start.searchParams.get("audioCodec"), "aac");
   assert.match(start.searchParams.get("X-Plex-Client-Profile-Extra")!, /audioCodec=aac/);
  } finally { movie.Media[0].audioCodec = "aac"; }
 });
 await t.test("resolves Plex show links as shows rather than videos", async () => {
  const link = `https://app.plex.tv/desktop/#!/server/${A}/details?key=%2Flibrary%2Fmetadata%2F1`;
  const result = await (await api(`/resolve?accounts=${ref}&url=${encodeURIComponent(link)}`)).json(); assert.equal(result.type, "channel"); assert.equal(result.id, `${A}.m.1`);
 });
 await t.test("rejects foreign manifest URLs and saves progress in milliseconds", async () => {
  assert.throws(() => rewriteManifest('<MPD><BaseURL>https://evil.test/</BaseURL></MPD>', `https://${A}.plex.direct:32400`, "/start.mpd", (p) => p), /another server/);
  assert.throws(() => rewriteManifest('<!DOCTYPE x><MPD/>', "https://plex.test", "/start.mpd", (p) => p), /Unsupported/);
  assert.equal((await api("/actions/progress", { method: "POST", body: JSON.stringify({ account: ref, videoId: `${A}.m.3`, position: 12.5 }) })).status, 200);
  assert.equal(requests.at(-1)?.url.searchParams.get("time"), "12500"); assert.equal(requests.at(-1)?.method, "POST");
 });
 await t.test("invalid Plex tokens require reconnecting without leaking them", async () => {
  resourceFailure = true; forgetServers(ref);
  const response = await api(`/following?accounts=${ref}`); assert.equal(response.status, 409); assert.equal((await response.json()).code, "relink");
  assert.equal((await api(`/accounts/${ref}`, { method: "DELETE" })).status, 200);
 });
});
