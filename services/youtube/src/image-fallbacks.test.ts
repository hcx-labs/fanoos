import assert from "node:assert/strict";
import { test } from "node:test";
import { thumbnailFallbacks } from "./image-fallbacks.ts";

test("missing maxres falls through to other sizes without retrying the same URL", () => {
  const urls = thumbnailFallbacks(new URL("https://i.ytimg.com/vi/id/maxresdefault.jpg"));
  assert.deepEqual(urls.map(url => url.pathname), ["/vi/id/hq720.jpg", "/vi/id/sddefault.jpg", "/vi/id/hqdefault.jpg"]);
});

test("a missing WebP or query-qualified image can fall back to canonical JPEGs", () => {
  const urls = thumbnailFallbacks(new URL("https://i1.ytimg.com/vi_webp/id/maxresdefault.webp?rs=provided"));
  assert.equal(urls[0]!.href, "https://i1.ytimg.com/vi/id/maxresdefault.jpg");
  assert.ok(urls.every(url => url.origin === "https://i1.ytimg.com"));
  const qualified = thumbnailFallbacks(new URL("https://i.ytimg.com/vi/id/hq720.jpg?sqp=provided"));
  assert.ok(qualified.some(url => url.href === "https://i.ytimg.com/vi/id/hq720.jpg"));
});

test("non-video artwork never gets video thumbnail fallbacks", () => {
  assert.deepEqual(thumbnailFallbacks(new URL("https://yt3.ggpht.com/avatar")), []);
  assert.deepEqual(thumbnailFallbacks(new URL("https://i.ytimg.com/vi/id/hqdefault.jpg")), []);
});
