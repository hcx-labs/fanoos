const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Downloads, serveFile, manifest } = require('./downloads.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = 'http://localhost:5180';
const profile = { id: 'test-profile', name: 'Test' };
const selection = { videoId: 'jNQXAC9IVRw', videoTrack: '137', audioTrack: '140', subtitles: ['en\nEnglish'] };

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanoos-downloads-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bytes = { video: Buffer.alloc(16384, 42), audio: Buffer.alloc(2048, 12) };
  let attempt = 0;
  const fixture = { calls: [], slow: false, revision: '1', ignoredRange: false };
  const track = (kind) => ({ id: kind === 'video' ? '137' : '140', kind, mimeType: `${kind}/mp4`, codecs: kind === 'video' ? 'avc1.640028' : 'mp4a.40.2', bandwidth: 10000, bytes: bytes[kind].length, revision: fixture.revision, label: kind, width: kind === 'video' ? 1920 : undefined, height: kind === 'video' ? 1080 : undefined, initRange: '0-9', indexRange: '10-19', url: `/api/b/youtube/public/media?track=${kind}&attempt=${attempt}` });
  const fetcher = async (url, init) => {
    const u = new URL(url);
    fixture.calls.push({ url, range: init.headers?.range });
    if (u.pathname.endsWith('/download')) { attempt++; return Response.json({ duration: 19, tracks: [track('video'), track('audio')], subtitles: [{ locale: 'en', label: 'English', format: 'vtt', url: `/api/b/youtube/public/captions?attempt=${attempt}` }] }); }
    if (u.pathname.endsWith(`/videos/${selection.videoId}`)) return Response.json({ video: { id: selection.videoId, backend: 'youtube', title: 'Test video', description: 'Saved description', published: '2026-10-20T12:00:00Z', chapters: [{ title: 'Intro', start: 0 }], segments: [{ category: 'sponsor', start: 5, end: 8 }], thumbnail: '/api/b/youtube/public/img', duration: 19 }, channel: { name: 'Test channel' }, stream: {} });
    if (u.pathname.endsWith('/captions')) return new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n');
    if (u.pathname.endsWith('/img')) return new Response(Buffer.from([255,216,255,217]));
    if (u.pathname.endsWith('/media')) {
      const data = bytes[u.searchParams.get('track')];
      const requested = Number(/^bytes=(\d+)-$/.exec(init.headers?.range || '')?.[1] || 0);
      const offset = fixture.ignoredRange ? 0 : requested;
      let i = offset;
      const body = new ReadableStream({ async pull(controller) {
        if (fixture.slow) await sleep(5);
        if (init.signal.aborted) { controller.error(new Error('aborted')); return; }
        if (i >= data.length) { controller.close(); return; }
        const end = Math.min(i + 1024, data.length); controller.enqueue(data.subarray(i, end)); i = end;
      } });
      return new Response(body, { status: offset ? 206 : 200, headers: { 'content-length': String(data.length - offset), ...(offset ? { 'content-range': `bytes ${offset}-${data.length-1}/${data.length}` } : {}) } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const create = () => new Downloads({ directory, fetch: fetcher });
  const downloads = create(); downloads.bind(server, profile);
  return Object.assign(fixture, { downloads, create, directory, bytes });
}
async function until(condition) { for (let i = 0; i < 400; i++) { if (condition()) return; await sleep(5); } throw new Error('Timed out'); }

test('downloads tracks and fresh caption URLs, then serves an offline manifest', async (t) => {
  const { downloads: d, bytes, calls } = await fixture(t);
  const item = await d.add(selection);
  await until(() => ['complete','failed'].includes(d.item(item.id).status));
  assert.equal(d.item(item.id).status, 'complete', d.item(item.id).error);
  assert.deepEqual(await fs.readFile(path.join(d.folder(item), 'video.track')), bytes.video);
  assert.deepEqual(await fs.readFile(path.join(d.folder(item), 'audio.track')), bytes.audio);
  assert.ok(calls.some((c) => c.url.endsWith('/captions?attempt=2')));
  const detail = d.detail(item.id);
  assert.ok(detail.stream.dash.startsWith('fanoos-offline://app/'));
  const response = await d.media(item.id, 'manifest.mpd', new Request(detail.stream.dash));
  const text = await response.text();
  assert.match(text, /<BaseURL>video.track<\/BaseURL>/);
  assert.doesNotMatch(text, /localhost|attempt=/);
  assert.equal(detail.stream.subtitles[0].format, 'vtt');
  const restored = new Downloads({ directory: d.directory, fetch: () => { throw new Error('Offline'); } });
  assert.equal(restored.detail(item.id).video.description, 'Saved description');
  assert.deepEqual(restored.detail(item.id).video.chapters, [{ title: 'Intro', start: 0 }]);
  assert.deepEqual(restored.detail(item.id).video.segments, [{ category: 'sponsor', start: 5, end: 8 }]);
  assert.ok(restored.detail(item.id).downloadedAt > 0);
});

test('resumes partial files after restart with fresh URLs and byte ranges', async (t) => {
  const f = await fixture(t); f.slow = true;
  const item = await f.downloads.add(selection);
  await until(() => f.downloads.item(item.id).received >= 2048);
  await f.downloads.pause(item.id);
  const offset = (await fs.stat(path.join(f.downloads.folder(item), 'video.track.part'))).size;
  const restarted = f.create(); restarted.bind(server, profile); restarted.resume(item.id);
  await until(() => ['complete','failed'].includes(restarted.item(item.id).status));
  assert.equal(restarted.item(item.id).status, 'complete', restarted.item(item.id).error);
  assert.ok(f.calls.some((c) => c.range === `bytes=${offset}-` && c.url.includes('attempt=3')));
  assert.deepEqual(await fs.readFile(path.join(restarted.folder(item), 'video.track')), f.bytes.video);
});

test('restarts a track when a refreshed source changed or ignores Range', async (t) => {
  for (const changed of [false, true]) {
    const f = await fixture(t); f.slow = true;
    const item = await f.downloads.add(selection);
    await until(() => f.downloads.item(item.id).received >= 2048);
    await f.downloads.pause(item.id);
    f.revision = changed ? '2' : '1'; f.ignoredRange = !changed;
    f.downloads.resume(item.id);
    await until(() => ['complete','failed'].includes(f.downloads.item(item.id).status));
    assert.equal(f.downloads.item(item.id).status, 'complete', f.downloads.item(item.id).error);
    assert.deepEqual(await fs.readFile(path.join(f.downloads.folder(item), 'video.track')), f.bytes.video);
  }
});

test('profile isolation, sign-out locking, and safe source URLs', async (t) => {
  const { downloads: d } = await fixture(t);
  const item = await d.add(selection); await until(() => d.item(item.id).status === 'complete');
  d.bind(server, { id: 'another-profile', name: 'Other' });
  assert.equal(d.list().items.length, 0);
  assert.throws(() => d.detail(item.id), /not found/);
  await assert.rejects(d.request(server, 'https://example.org/api/media'), /Fanoos server/);
  await assert.rejects(d.request(server, '/not-an-api'), /Fanoos server/);
  d.bind(server, profile); await d.lock();
  assert.equal(d.list().items.length, 0);
  assert.throws(() => d.detail(item.id), /sign in/);
});

test('old storage caps are discarded and no longer block downloads', async (t) => {
  const { downloads, create } = await fixture(t);
  downloads.data.limitBytes = 1;
  downloads.save();
  const restored = create();
  assert.equal('limitBytes' in restored.data, false);
  const item = await restored.add(selection);
  await until(() => ['complete', 'failed'].includes(restored.item(item.id).status));
  assert.equal(restored.item(item.id).status, 'complete', restored.item(item.id).error);
});

test('low disk space fails before queuing', async (t) => {
  const { downloads: d } = await fixture(t);
  d.free = () => 0;
  await assert.rejects(d.add(selection), /free disk space/);
  assert.equal(d.list().items.length, 0);
});

test('offline progress tracks only changed items for later merging', async (t) => {
  const { downloads: d } = await fixture(t);
  d.writeState({ progress: { a: 1, b: 2 }, history: [] }, false);
  d.writeState({ progress: { a: 30, b: 2 }, history: [{ id: 'a', at: '2026-10-20' }] }, true);
  assert.deepEqual(d.readState().pendingProgress, { a: 30 });
  d.writeState({ progress: { a: 30, b: 2 }, history: [{ id: 'a', at: '2026-10-20' }] }, true);
  assert.deepEqual(d.readState().pendingProgress, { a: 30 });
  d.writeState({ progress: { b: 2 }, history: [] }, true);
  assert.deepEqual(d.readState().pendingProgress, { a: null });
  d.writeState({ progress: { a: 30, b: 200 }, history: [] }, false);
  assert.equal(d.readState().dirty, false);
  assert.deepEqual(d.readState().pendingProgress, {});
});

test('local media supports seeking, suffix ranges, HEAD, and invalid ranges', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fanoos-ranges-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'track'); await fs.writeFile(file, '0123456789');
  for (const [range, text] of [['bytes=2-4','234'], ['bytes=-3','789'], ['bytes=7-','789']]) {
    const response = await serveFile(file, 'video/mp4', new Request('https://test/track', { headers: { range } }));
    assert.equal(response.status, 206); assert.equal(await response.text(), text);
  }
  const head = await serveFile(file, 'video/mp4', new Request('https://test/track', { method: 'HEAD' }));
  assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  for (const range of ['bytes=99-100','bytes=5-2','bytes=-0','bytes=1-2,4-5']) assert.equal((await serveFile(file, 'video/mp4', new Request('https://test/track', { headers: { range } }))).status, 416);
  assert.match(manifest(19, {kind:'video',label:'a&b',id:'1',bandwidth:1}, {kind:'audio',id:'2',bandwidth:1}), /a&amp;b/);
});
