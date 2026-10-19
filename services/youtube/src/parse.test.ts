import assert from "node:assert/strict";
import { test } from "node:test";
import { thumb } from "./parse.ts";

test("prefer the largest full-size image supplied by YouTube and keep its query", () => {
  const images = [
    { url: "https://i.ytimg.com/vi/id/hqdefault.jpg", width: 480, height: 360 },
    { url: "https://i.ytimg.com/vi/id/hq720.jpg?sqp=provided-size&rs=provided-signature", width: 1280, height: 720 },
    { url: "https://i.ytimg.com/vi/id/maxresdefault.jpg?rs=full-size", width: 1920, height: 1080 },
  ];
  assert.equal(thumb("id", images), images[2]!.url);
  assert.equal(thumb("id", images.slice(0, 2)), images[1]!.url);
  assert.equal(images[0]!.width, 480);
});

test("low resolution and letterboxed candidates do not stop the full-size lookup", () => {
  assert.equal(thumb("id", [{ url: "https://i.ytimg.com/vi/id/hqdefault.jpg", width: 480, height: 360 }]), "https://i.ytimg.com/vi/id/maxresdefault.jpg");
  assert.equal(thumb("id"), "https://i.ytimg.com/vi/id/maxresdefault.jpg");
});

test("reject malformed or unrelated metadata URLs and accept YouTube image variants", () => {
  const candidates = [
    { url: "not a url", width: 1920, height: 1080 },
    { url: "https://example.com/image.jpg", width: 1920, height: 1080 },
    { url: "http://i.ytimg.com/vi/id/maxresdefault.jpg", width: 1920, height: 1080 },
  ];
  assert.equal(thumb("id", candidates), "https://i.ytimg.com/vi/id/maxresdefault.jpg");
  assert.equal(thumb("id", [{ url: "//i1.ytimg.com/vi_webp/id/maxresdefault.webp?rs=keep", width: 1280, height: 720 }]), "//i1.ytimg.com/vi_webp/id/maxresdefault.webp?rs=keep");
});
