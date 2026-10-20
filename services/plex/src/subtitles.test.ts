import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "fanoos-subtitle-test-"));
process.env.DATA_DIR = directory;
const { loadSubtitle, subtitleTracks } = await import("./subtitles.ts");
const server = { id: "a".repeat(40), name: "Plex", url: "https://plex.test", token: "private-test-token", clientId: "test-client" };
const script = "[Script Info]\nTitle: Test\n[V4+ Styles]\nStyle: Default,Arial,28\n[Events]\nDialogue: 0,0:00:00.20,0:00:01.50,Default,,0,0,0,,Hello {\\i1}Fanoos{\\i0}\n";
const originalFetch = globalThis.fetch;
const requests: URL[] = [];
let mismatch = false, rejected = false, malformed = false, externalChange = false;
let preference = 7;
const mutations: URL[] = [];
const ticket = { key: "603", part: 33, stream: 7, external: false, format: "ass" as const };

test("Plex native subtitle delivery", async (t) => {
 globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)); requests.push(url);
  assert.equal(url.origin, server.url);
  assert.equal(new Headers(init?.headers).get("x-plex-token"), server.token);
  if (url.pathname === "/library/metadata/603") return Response.json({ MediaContainer: { Metadata: [{ Media: [{ Part: [{ id: "33", Stream: [{ id: "1", streamType: 2, selected: true }, ...[7,8].map((id) => ({ id: String(id), streamType: 3, codec: "srt", selected: preference === id }))] }] }] }] } });
  if (url.pathname === "/library/parts/33" && init?.method === "PUT") {
   assert.equal(url.searchParams.has("audioStreamID"), false, "Subtitle selection must not change audio");
   preference = Number(url.searchParams.get("subtitleStreamID")); mutations.push(url);
   return new Response(null, { status: 200 });
  }
  if (url.pathname.endsWith("/decision")) return Response.json({ MediaContainer: { generalDecisionCode: rejected ? 4005 : 1000, Metadata: [{ Media: [{ Part: [{ id: "33", Stream: [{ id: mismatch ? "99" : String(preference), streamType: 3, selected: true }] }] }] }] } });
  if (url.pathname === "/subtitles/:/transcode/universal/start") { if (externalChange) preference = 8; return new Response(malformed ? "<html>Not a subtitle</html>" : script, { headers: { "content-type": "application/octet-stream" } }); }
  if (url.pathname.endsWith("/stop")) return new Response(null, { status: 200 });
  if (url.pathname === "/library/streams/10") return new Response("1\r\n00:00:00,200 --> 00:00:01,500\r\nHello Fanoos\r\n");
  throw Error(`Unexpected Plex request: ${url.pathname}`);
 };
 try {
  await t.test("negotiates direct play and downloads only ASS through Plex's subtitle-only endpoint", async () => {
   const text = await loadSubtitle(server, ticket);
   assert.equal(text, script);
   assert.equal(mutations.length, 0, "Already-selected tracks need no preference mutation");
   const decision = requests.find((url) => url.pathname.endsWith("/decision"))!;
   const start = requests.find((url) => url.pathname === "/subtitles/:/transcode/universal/start")!;
   assert.equal(start.searchParams.toString(), decision.searchParams.toString());
   assert.equal(start.searchParams.get("directPlay"), "1");
   assert.equal(start.searchParams.get("protocol"), "http");
   assert.equal(start.searchParams.get("subtitles"), "sidecar");
   assert.equal(start.searchParams.get("subtitleStreamID"), "7");
   assert.match(start.searchParams.get("X-Plex-Client-Profile-Extra")!, /DirectPlayStreamSelection=true/);
   assert.equal(requests.at(-1)?.searchParams.get("session"), start.searchParams.get("session"));
   assert.ok(requests.every((url) => !url.pathname.startsWith("/library/parts/") && !url.pathname.endsWith("start.mpd")));
  });
  await t.test("concurrent languages serialize preference changes and use isolated sessions with cleanup", async () => {
   requests.length = 0;
   await Promise.all([loadSubtitle(server, ticket), loadSubtitle(server, { ...ticket, stream: 8 })]);
   const starts = requests.filter((url) => url.pathname === "/subtitles/:/transcode/universal/start");
   assert.equal(new Set(starts.map((url) => url.searchParams.get("session"))).size, 2);
   assert.deepEqual(new Set(starts.map((url) => url.searchParams.get("subtitleStreamID"))), new Set(["7", "8"]));
   assert.equal(requests.filter((url) => url.pathname.endsWith("/stop")).length, 2);
  });
  await t.test("rejects a wrong track, failed decision and malformed payload; always stops its session", async () => {
   for (const mode of ["mismatch", "rejected", "malformed"]) {
    requests.length = 0; mismatch = mode === "mismatch"; rejected = mode === "rejected"; malformed = mode === "malformed";
    await assert.rejects(loadSubtitle(server, ticket), (error: unknown) => (error as { status: number }).status === 502);
    assert.ok(requests.at(-1)?.pathname.endsWith("/stop"));
   }
   mismatch = rejected = malformed = false;
  });
  await t.test("selects an unselected embedded SRT before negotiation and restores Off after success", async () => {
   preference = 0; mutations.length = 0;
   assert.equal(await loadSubtitle(server, ticket), script);
   assert.deepEqual(mutations.map((u) => u.searchParams.get("subtitleStreamID")), ["7", "0"]);
   assert.equal(preference, 0);
   preference = 7;
  });
  await t.test("restores the prior language when subtitle preparation fails", async () => {
   preference = 8; mutations.length = 0; malformed = true;
   try { await assert.rejects(loadSubtitle(server, ticket)); }
   finally { malformed = false; }
   assert.deepEqual(mutations.map((u) => u.searchParams.get("subtitleStreamID")), ["7", "8"]);
   assert.equal(preference, 8); preference = 7;
  });
  await t.test("does not overwrite a newer subtitle selection from another Plex client", async () => {
   preference = 0; mutations.length = 0; externalChange = true;
   try { await loadSubtitle(server, ticket); } finally { externalChange = false; }
   assert.deepEqual(mutations.map((u) => u.searchParams.get("subtitleStreamID")), ["7"]);
   assert.equal(preference, 8); preference = 7;
  });
  await t.test("external SRT uses the stream endpoint and becomes WebVTT without touching the media file", async () => {
   requests.length = 0;
   const text = await loadSubtitle(server, { ...ticket, stream: 10, external: true, format: "vtt" });
   assert.match(text, /^WEBVTT/); assert.match(text, /00:00:00\.200 --> 00:00:01\.500/);
   assert.equal(requests.length, 1); assert.equal(requests[0]!.pathname, "/library/streams/10");
  });
  await t.test("embedded text is rendered as ASS, only image tracks retain burn-in", () => {
   const tracks = subtitleTracks("account", server, { ratingKey: "603", title: "Episode", type: "episode" }, { id: 33, key: "/library/parts/33/file.mkv", Stream: [{ id: 7, streamType: 3, codec: "srt" }, { id: 8, streamType: 3, codec: "ass" }, { id: 9, streamType: 3, codec: "pgs" }] });
   assert.equal(tracks[0]!.format, "ass"); assert.equal(tracks[0]!.render, undefined);
   assert.equal(tracks[1]!.format, "ass"); assert.equal(tracks[1]!.render, undefined);
   assert.equal(tracks[2]!.render, "server");
  });
 } finally { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); }
});
