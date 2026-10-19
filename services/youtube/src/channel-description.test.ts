import assert from "node:assert/strict";
import { test } from "node:test";
import { YTNodes } from "youtubei.js";
import { channelDescription } from "./channel-description.ts";

test("read the full modern About description, retaining paragraph breaks", () => {
  const description = "Twitter: https://example.com/profile\r\n\r\nFull biography beyond the SEO preview.";
  const metadata = new YTNodes.AboutChannelView({ description });
  assert.equal(channelDescription({ metadata }), description.replace(/\r\n/g, "\n"));
});

test("read legacy About Text runs without truncating or flattening line breaks", () => {
  const about = new YTNodes.ChannelAboutFullMetadata({ description: { runs: [{ text: "First paragraph\n\n" }, { text: "https://example.com/full-link" }] } });
  assert.equal(channelDescription(about), "First paragraph\n\nhttps://example.com/full-link");
});

test("empty descriptions stay empty rather than becoming object text", () => {
  assert.equal(channelDescription({}), "");
  assert.equal(channelDescription({ metadata: { description: "" }, description: "Old preview…" }), "");
});
