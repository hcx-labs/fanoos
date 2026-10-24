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
let linked = false; let resourceFailure = false; let currentAudio = 8; let canCopy = true;
const movie = { ratingKey: "4", title: "Test Movie", type: "movie", librarySectionID: 10, librarySectionTitle: "Movies", duration: 120000, originallyAvailableAt: "2001-12-19", year: 2001, addedAt: 12345, thumb: "/library/metadata/4/thumb/1", Media: [{ width: 1920, height: 1080, videoResolution: "1080", bitrate: 12000, container: "mp4", videoCodec: "h264", audioCodec: "aac", Part: [{ id: 44, key: "/library/parts/44/file.mp4", size: 4, container: "mp4", Stream: [] }] }] };
const show = { ratingKey: "1", type: "show", title: "Test Show", leafCount: 1, thumb: "/library/metadata/1/thumb/1" };
const season = { ratingKey: "2", type: "season", title: "Season 1", parentRatingKey: "1", leafCount: 1 };
const episode = { ratingKey: "3", type: "episode", title: "Test Episode", parentRatingKey: "2", parentTitle: "Season 1", parentIndex: 1, grandparentRatingKey: "1", grandparentTitle: "Test Show", index: 1, duration: 60000, viewOffset: 5000, Media: [{ width: 1920, height: 1080, videoResolution: "1080", bitrate: 14000, container: "mkv", videoCodec: "hevc", audioCodec: "dca", Part: [{ id: 33, key: "/library/parts/33/file.mkv", size: 2048, Stream: [{ id: 8, streamType: 2, languageCode: "ja", displayTitle: "Japanese", selected: true }, { id: 9, streamType: 2, languageCode: "en", displayTitle: "English" }, { id: 7, streamType: 3, codec: "srt", language: "English", languageCode: "en" }, { id: 10, streamType: 3, codec: "srt", key: "/library/streams/10", languageCode: "en", displayTitle: "English (external)" }, { id: 11, streamType: 3, codec: "pgs", languageCode: "en", displayTitle: "English (PGS)" }] }] }] };
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
 if (url.pathname === "/library/metadata/1/thumb/1") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
 if (url.pathname === "/identity") return container({ machineIdentifier: id });
 if (url.pathname === "/library/sections") return container({ Directory: [{ key: "10", title: "Movies", type: "movie" }, { key: "20", title: "TV", type: "show" }] });
 if (url.pathname === "/library/sections/10/all") return container({ Metadata: [movie], totalSize: 1 });
 if (url.pathname === "/library/sections/20/all") return container({ Metadata: url.searchParams.get("type") === "4" ? [episode] : [show], totalSize: 51 });
 if (url.pathname === "/library/metadata/1") return container({ Metadata: [show] });
 if (url.pathname === "/library/metadata/1/children") return container({ Metadata: [season] });
 if (url.pathname === "/library/metadata/2/children") return container({ Metadata: [episode] });
 if (url.pathname === "/library/metadata/3") return container({ Metadata: [{ ...episode, Media: episode.Media.map((m) => ({ ...m, Part: m.Part.map((p) => ({ ...p, Stream: p.Stream.map((s) => s.streamType === 2 ? { ...s, selected: s.id === currentAudio } : s) })) })) }] });
 if (url.pathname === "/library/metadata/4") return container({ Metadata: [movie], librarySectionID: 10 });
 if (url.pathname === "/library/onDeck") return container({ Metadata: [episode] });
 if (url.pathname === "/hubs/search") return container({ Hub: [{ Metadata: [show, episode, movie] }] });
 if (url.pathname === "/video/:/transcode/universal/decision") return container({ Metadata: [{ Media: [{ Part: [{ id: 33, Stream: [{ id: 12, streamType: 1, decision: canCopy ? "copy" : "transcode" }, { id: currentAudio, streamType: 2, decision: "copy", selected: true }] }] }] }] });
 if (url.pathname === "/video/:/transcode/universal/start.mpd") {
  const sid = url.searchParams.get("session");
  return new Response(`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><BaseURL>/video/:/transcode/universal/session/${sid}/dash/?X-Plex-Token=must-not-leak</BaseURL><Period><AdaptationSet><Representation id="0"><SegmentTemplate initialization="init.mp4" media="chunk-$Number$.m4s" /></Representation></AdaptationSet></Period></MPD>`, { headers: { "content-type": "application/dash+xml" } });
 }
 if (url.pathname.includes("/chunk-1.m4s")) return new Response("segment", { headers: { "content-type": "video/mp4" } });
 if (url.pathname === "/library/parts/33" && init?.method === "PUT") { if (url.searchParams.has("audioStreamID")) currentAudio = Number(url.searchParams.get("audioStreamID")); return new Response(null, { status: 200 }); }
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
 await t.test("artwork URLs stay stable and the shared cache avoids repeat Plex image downloads", async () => {
  const { image } = await import("./catalog.ts");
  const { serverFor } = await import("./client.ts");
  const server = await serverFor(ref, A);
  const path = image(ref, server, "/library/metadata/1/thumb/1")!;
  const clock = Date.now;
  const now = clock();
  try {
    Date.now = () => Math.floor(now / 86400000) * 86400000 + 3600000;
    const first = image(ref, server, "/library/metadata/1/thumb/1");
    Date.now = () => Math.floor(now / 86400000) * 86400000 + 3602000;
    assert.equal(image(ref, server, "/library/metadata/1/thumb/1"), first);
  } finally { Date.now = clock; }
  const count = () => requests.filter((r) => r.url.pathname === "/library/metadata/1/thumb/1").length;
  const before = count();
  for (let i = 0; i < 2; i++) {
   const response = await service.app.request(path);
   assert.equal(response.status, 200);
   assert.equal(response.headers.get("cache-control"), "private, max-age=86400");
   assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  }
  assert.equal(count(), before + 1);
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
 await t.test("catalog page sizes reach Plex and explicit sync refreshes the shared browse cache", async () => {
  const path = `/channels/${A}.l.20?accounts=${ref}&limit=15&sort=new`;
  await api(path);
  const reads = () => requests.filter((r) => r.url.pathname === "/library/sections/20/all" && r.url.searchParams.get("X-Plex-Container-Size") === "15").length;
  const before = reads(); assert.ok(before > 0);
  const upstream = requests.findLast((r) => r.url.pathname === "/library/sections/20/all")!.url;
  assert.equal(upstream.searchParams.get("sort"), "originallyAvailableAt:desc");
  await api(path); assert.equal(reads(), before);
  await api(path + "&refresh=1"); assert.equal(reads(), before + 1);
  await api(path); assert.equal(reads(), before + 1);
  await api(`/channels/${A}.l.20?accounts=${ref}&limit=6&next=15`);
  const mobile = requests.findLast((r) => r.url.pathname === "/library/sections/20/all")!.url;
  assert.equal(mobile.searchParams.get("X-Plex-Container-Size"), "6");
  assert.equal(mobile.searchParams.get("X-Plex-Container-Start"), "15");
 });
 await t.test("movies have their own detail parent and release dates", async () => {
  const page = await (await api(`/channels/${A}.m.4?accounts=${ref}`)).json();
  assert.equal(page.channel.kind, "movie"); assert.equal(page.channel.name, "Test Movie");
  assert.equal(page.videos.length, 1); assert.equal(page.sections, undefined);
  assert.equal(page.videos[0].channelId, page.channel.id);
  assert.equal(page.videos[0].published, "2001-12-19T00:00:00.000Z");
  assert.equal(page.videos[0].addedAt, undefined);
 });
 await t.test("release dates drive curation even when old media was imported today", async () => {
  const { releaseDate, showChannel, video } = await import("./catalog.ts");
  const { serverFor } = await import("./client.ts");
  const server = await serverFor(ref, A);
  const imported = { ...movie, addedAt: Math.floor(Date.now() / 1000) };
  assert.equal(video(ref, server, imported).published, "2001-12-19T00:00:00.000Z");
  assert.equal(showChannel(ref, server, imported).lastActivity, Date.parse("2001-12-19") / 1000);
  assert.equal(releaseDate({ ...imported, originallyAvailableAt: undefined }), "");
  assert.equal(releaseDate({ ...imported, originallyAvailableAt: "not-a-date" }), "");
  assert.equal((await api(`/feed?accounts=${ref}`)).status, 200);
  assert.ok(requests.some((r) => r.url.pathname === "/library/sections/10/all" && r.url.searchParams.get("sort") === "originallyAvailableAt:desc"));
 });
 await t.test("embedded subtitles and selected audio get scoped playback routes", async () => {
  const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json();
  assert.equal(detail.stream.subtitles.length, 3);
  assert.equal(detail.stream.subtitles[0].render, undefined);
  assert.match(detail.stream.subtitles[0].url, /^\/public\/text-subtitle\//);
  assert.match(detail.stream.subtitles[1].url, /^\/public\/text-subtitle\//);
  assert.equal((await service.app.request(detail.stream.subtitles[0].url + "tampered")).status, 403);
  assert.deepEqual(detail.stream.audioTracks.filter((track: { mode: string }) => track.mode === "transcode").map((track: { label: string }) => track.label), ["Japanese", "English"]);
  const track = detail.stream.audioTracks.find((track: { id: string }) => track.id === "9");
  assert.ok(track.sources.every((source: { stream: { dash?: string; progressive?: string } }) => source.stream.dash && !source.stream.progressive));
  assert.equal((await service.app.request(track.sources[0].stream.dash)).status, 200);
  assert.equal(requests.findLast((r) => r.url.pathname.endsWith("start.mpd"))?.url.searchParams.get("audioStreamID"), "9");
 });
 await t.test("progressive original audio follows the file default rather than the Plex account selection", async () => {
  currentAudio = 9;
  try {
   const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json();
   assert.equal(detail.stream.originalAudio.label, "Japanese");
   assert.ok(detail.stream.audioTracks.some((track: { id: string }) => track.id === "original-9"));
  } finally { currentAudio = 8; }
 });
 await t.test("original language switching copies video and audio and restores the previous selection", async () => {
  currentAudio = 8;
  const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json();
  const track = detail.stream.audioTracks.find((track: { id: string }) => track.id === "original-9");
  assert.equal(track.mode, "original"); assert.equal(track.sources[0].kind, "original");
  const result = await service.app.request(track.sources[0].stream.dash);
  assert.equal(result.status, 200); assert.equal(currentAudio, 8);
  const start = requests.findLast((r) => r.url.pathname.endsWith("start.mpd"))!.url;
  assert.equal(start.searchParams.get("directStream"), "1");
  assert.equal(start.searchParams.get("directStreamAudio"), "1");
  assert.equal(start.searchParams.get("audioChannelCount"), null);
  assert.equal(start.searchParams.get("audioCodec"), "dca");
  assert.equal(start.searchParams.get("videoCodec"), "hevc");
  assert.equal(start.searchParams.get("X-Plex-Client-Profile-Name"), "Generic");
 });
 await t.test("original audio refuses silent conversion and restores preferences if copy is unavailable", async () => {
  currentAudio = 8; canCopy = false;
  const detail = await (await api(`/videos/${A}.m.3?accounts=${ref}`)).json();
  const track = detail.stream.audioTracks.find((track: { id: string }) => track.id === "original-9");
  const starts = () => requests.filter((r) => r.url.pathname.endsWith("start.mpd")).length;
  const before = starts();
  try {
   const result = await service.app.request(track.sources[0].stream.dash);
   assert.equal(result.status, 502); assert.match((await result.json()).error, /Choose Transcode/);
   assert.equal(starts(), before); assert.equal(currentAudio, 8);
  } finally { canCopy = true; }
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
 await t.test("offers the original file for desktop downloads with text subtitles only", async () => {
  const plan = await (await api(`/videos/${A}.m.4/download?accounts=${ref}`)).json();
  assert.deepEqual(plan.tracks, []); assert.equal(plan.duration, 120);
  assert.equal(plan.files.length, 1); assert.equal(plan.files[0].mimeType, "video/mp4"); assert.equal(plan.files[0].bytes, 4); assert.equal(plan.files[0].label, "Original · 1080p");
  const response = await service.app.request(plan.files[0].url, { headers: { range: "bytes=0-3" } }); assert.equal(response.status, 206);
  assert.ok(!JSON.stringify(plan).includes("private-server-token"));
  const episodePlan = await (await api(`/videos/${A}.m.3/download?accounts=${ref}`)).json();
  assert.equal(episodePlan.files[0].mimeType, "video/x-matroska"); assert.equal(episodePlan.files[0].audio, "Japanese");
  assert.deepEqual(episodePlan.subtitles.map((s: { id: string }) => s.id), ["7", "10"]);
  const conversions = episodePlan.conversions as { id: string; audio: { id: string; label: string; default?: boolean }; quality: { id: string; copy?: boolean; codec?: string }; bitrate: number; manifest: string }[];
  assert.deepEqual([...new Set(conversions.map((c) => c.audio.label))], ["Japanese", "English"]);
  assert.equal(conversions.find((c) => c.audio.default)?.audio.id, "8");
  assert.deepEqual(conversions.filter((c) => c.audio.id === "9").map((c) => c.quality.id), ["transcode-auto", "transcode-1080", "transcode-720", "transcode-480", "transcode-360"]);
  assert.ok(conversions.every((c) => c.manifest.startsWith("/public/play/") && c.bitrate > 0));
  // Original keeps the file's HEVC video and converts only the audio, to AAC stereo.
  const original = conversions.find((c) => c.id === "9:transcode-auto")!;
  assert.equal(original.quality.copy, true);
  assert.equal(original.quality.codec, "hevc");
  assert.ok(conversions.filter((c) => !c.quality.copy).every((c) => c.quality.codec === "h264"));
  assert.equal((await service.app.request(original.manifest)).status, 200);
  const start = requests.findLast((r) => r.url.pathname.endsWith("start.mpd"))!.url;
  assert.equal(start.searchParams.get("directStream"), "1");
  assert.equal(start.searchParams.get("videoCodec"), "hevc");
  assert.match(start.searchParams.get("X-Plex-Client-Profile-Extra")!, /videoCodec=hevc,h264&audioCodec=aac/);
  assert.equal(start.searchParams.get("audioCodec"), "aac");
  assert.equal(start.searchParams.get("audioChannelCount"), "2");
  assert.equal(start.searchParams.get("audioStreamID"), "9");
  // An average-bitrate cap is below the video's peaks and makes Plex re-encode.
  assert.equal(start.searchParams.get("maxVideoBitrate"), "200000");
  assert.equal(start.searchParams.get("X-Plex-Client-Profile-Name"), "Generic");
  const decision = requests.findLast((r) => r.url.pathname.endsWith("/decision"))!.url;
  assert.equal(decision.searchParams.get("session"), start.searchParams.get("session"));
  assert.equal((await api(`/videos/${A}.l.10/download?accounts=${ref}`)).status, 400);
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
