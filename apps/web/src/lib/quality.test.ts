import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveQuality } from "./quality.ts";

test("resolve saved quality against each video's heights without changing the preference", () => {
  const preference = "1440p";
  assert.equal(effectiveQuality(preference, [360, 1080, 720]), "1080p");
  assert.equal(effectiveQuality(preference, [2160, 1440, 1080]), "1440p");
  assert.equal(preference, "1440p");
  assert.equal(effectiveQuality("900p", [1080, 720, 480]), "720p");
  assert.equal(effectiveQuality("144p", [1080, 720]), "720p");
  assert.equal(effectiveQuality("auto", [1080, 720]), "auto");
  assert.equal(effectiveQuality("1440p", []), "auto");
  assert.equal(effectiveQuality("invalid", [1080]), "auto");
});
