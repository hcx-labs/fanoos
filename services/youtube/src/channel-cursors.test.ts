import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelCursors } from "./channel-cursors.ts";

test("channel cursors bind to a channel and reuse one result for concurrent requests", async () => {
  const cursors = new ChannelCursors<{ videos: string[]; next: string }>();
  let calls = 0;
  const token = await cursors.remember("channel-a", async () => {
    calls++;
    return { videos: ["video-b"], next: "next-page" };
  });
  await assert.rejects(cursors.next("channel-b", token), { status: 410 });
  const [a, b] = await Promise.all([cursors.next("channel-a", token), cursors.next("channel-a", token)]);
  assert.strictEqual(a, b);
  assert.strictEqual(await cursors.next("channel-a", token), a);
  assert.equal(calls, 1);
});

test("a failed upstream load can be retried with the same cursor", async () => {
  const cursors = new ChannelCursors<number>();
  let calls = 0;
  const token = await cursors.remember("channel-a", async () => {
    if (++calls === 1) throw new Error("temporary upstream failure");
    return 42;
  });
  await assert.rejects(cursors.next("channel-a", token), /temporary/);
  assert.equal(await cursors.next("channel-a", token), 42);
  assert.equal(calls, 2);
});

test("expired, missing and evicted cursors require a restart", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const cursors = new ChannelCursors<number>(100, 1);
  const first = await cursors.remember("a", async () => 1);
  const second = await cursors.remember("a", async () => 2);
  await assert.rejects(cursors.next("a", first), { status: 410 });
  context.mock.timers.tick(101);
  await assert.rejects(cursors.next("a", second), { status: 410 });
  await assert.rejects(cursors.next("a", "invalid"), { status: 410 });
});

test("unknown cursor lookups cannot evict valid entries in a full cache", async () => {
  const cursors = new ChannelCursors<number>(60_000, 1);
  const token = await cursors.remember("a", async () => 42);
  await assert.rejects(cursors.next("a", "x".repeat(24)), { status: 410 });
  assert.equal(await cursors.next("a", token), 42);
});
