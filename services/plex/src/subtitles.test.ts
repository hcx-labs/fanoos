import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "fanoos-subtitle-test-"));
process.env.DATA_DIR = directory;
const { extractSubtitle } = await import("./subtitles.ts");
const script = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.20,0:00:01.50,Default,,0,0,0,,Hello {\\i1}Fanoos{\\i0}
`;

test("extracts embedded subtitles without re-encoding media", async (t) => {
 try {
  writeFileSync(join(directory, "source.ass"), script);
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=2", "-i", join(directory, "source.ass"), "-map", "0:v", "-map", "1:s", "-c:v", "libx264", "-c:s", "ass", join(directory, "source.mkv")]);
  const media = readFileSync(join(directory, "source.mkv"));
  let reads = 0;
  const load = async (_method: string, range: string | undefined) => {
   reads++;
   const start = Number(/^bytes=(\d+)-/.exec(range || "")?.[1] || 0);
   const body = media.subarray(start);
   return new Response(body, { status: range ? 206 : 200, headers: { "content-type": "video/x-matroska", "content-length": String(body.length), "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${start}-${media.length - 1}/${media.length}` } : {}) } });
  };
  await t.test("ASS keeps authored styles, timing and formatting", async () => {
   const text = (await extractSubtitle(load, "0:1", "ass")).toString();
   assert.match(text, /Style: Default,Arial,28/); assert.match(text, /Hello \{\\i1\}Fanoos\{\\i0\}/); assert.match(text, /0:00:00.20,0:00:01.50/);
  });
  await t.test("text tracks can be emitted as timed WebVTT", async () => {
   const text = (await extractSubtitle(load, "0:s:0", "webvtt")).toString();
   assert.match(text, /^WEBVTT/); assert.match(text, /00:00\.200 --> 00:01\.500/); assert.match(text, /Fanoos/);
   assert.ok(reads > 0);
  });
  await t.test("rejects arbitrary FFmpeg mapping expressions", async () => {
   await assert.rejects(extractSubtitle(load, "0:v", "ass"), (error: unknown) => (error as { status: number }).status === 403);
  });
 } finally { rmSync(directory, { recursive: true, force: true }); }
});
