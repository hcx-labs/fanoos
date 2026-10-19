import assert from "node:assert/strict";
import { test } from "node:test";
import { channelList, channelListKey } from "./channel-list.ts";
import { ChannelCursors } from "./channel-cursors.ts";

test("channel search calls upstream search rather than inspecting the loaded uploads", async () => {
  const expected = { videos: [{ id: "older-result-not-in-first-page" }] };
  let term = "";
  const channel = {
    has_search: true,
    search: async (query: string) => { term = query; return expected; },
    getVideos: () => { throw new Error("Search must not load the latest uploads"); },
  };
  assert.strictEqual(await channelList(channel, { query: " older upload " }), expected);
  assert.equal(term, "older upload");
});

test("Popular requests YouTube's Popular filter and preserves its ordering", async () => {
  const expected = { videos: [{ id: "popular-old-upload" }] };
  const videos = {
    filters: ["Latest", "Popular", "Oldest"],
    applyFilter: async (filter: string) => { assert.equal(filter, "Popular"); return expected; },
  };
  const channel = { has_videos: true, getVideos: async () => videos };
  assert.strictEqual(await channelList(channel, { sort: "popular" }), expected);
  assert.strictEqual(await channelList(channel, { sort: "new" }), videos);
});

test("legacy popular sort is supported, unavailable modes fail explicitly", async () => {
  const expected = { videos: [] };
  assert.strictEqual(await channelList({ has_videos: true, getVideos: async () => ({ sort_filters: ["Most popular"], applySort: async () => expected }) }, { sort: "popular" }), expected);
  await assert.rejects(channelList({ has_videos: true, getVideos: async () => ({}) }, { sort: "popular" }), { status: 422 });
  await assert.rejects(channelList({ has_search: false }, { query: "test" }), { status: 422 });
});

test("cursors cannot cross channel, search or sort views", async () => {
  const cursors = new ChannelCursors<number>();
  const key = channelListKey("channel-a", { query: "cats" });
  const token = await cursors.remember(key, async () => 1);
  for (const other of [channelListKey("channel-b", { query: "cats" }), channelListKey("channel-a", { query: "dogs" }), channelListKey("channel-a", { sort: "popular" })]) {
    await assert.rejects(cursors.next(other, token), { status: 410 });
  }
  assert.equal(await cursors.next(key, token), 1);
});

test("legacy ChipCloudChip Popular uses its endpoint and returns a pageable library list", async () => {
  const { Parser, YTNodes, YT } = await import("youtubei.js");
  const response = Parser.parseResponse({
    onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [
      { videoRenderer: { videoId: "older-video", title: { simpleText: "An older popular upload" }, thumbnail: { thumbnails: [] } } },
      { continuationItemRenderer: { trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN", continuationEndpoint: { continuationCommand: { token: "next-popular", request: "CONTINUATION_REQUEST_TYPE_BROWSE" } } } },
    ] } }],
  });
  const chip = new YTNodes.ChipCloudChip({ text: { simpleText: "Popular" }, isSelected: false, navigationEndpoint: { browseEndpoint: { browseId: "channel" } } });
  let calls = 0;
  assert.ok(chip.endpoint);
  Object.defineProperty(chip.endpoint, "call", { value: async () => { calls++; return response; } });
  const videos = {
    filters: ["Popular"],
    filter_nodes: { primary_filters: [chip] },
    actions: {
      execute: async (endpoint: string, request: { continuation: string; parse: boolean }) => {
        assert.equal(endpoint, "browse");
        assert.equal(request.continuation, "next-popular");
        assert.equal(request.parse, true);
        return Parser.parseResponse({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [
          { videoRenderer: { videoId: "second-page-video", title: { simpleText: "Next popular upload" }, thumbnail: { thumbnails: [] } } },
        ] } }] });
      },
    },
    applyFilter: () => { throw new Error("Modern applyFilter must not handle legacy chips"); },
  };
  const list = await channelList({ has_videos: true, getVideos: async () => videos }, { sort: "popular" });
  assert.ok(list instanceof YT.FilteredChannelList);
  assert.equal(list.videos[0]?.as(YTNodes.Video).id, "older-video");
  assert.equal(list.has_continuation, true);
  const next = await list.getContinuation();
  assert.equal(next.videos[0]?.as(YTNodes.Video).id, "second-page-video");
  assert.equal(next.has_continuation, false);
  assert.equal(calls, 1);
});
