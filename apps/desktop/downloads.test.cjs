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
  return Object.assign(fixture, { downloads, create, directory, bytes, fetcher });
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

test('retries a dropped connection on its own', async (t) => {
  const f = await fixture(t);
  let failures = 1;
  const d = new Downloads({ directory: f.directory, retryDelays: [20], fetch: async (url, init) => {
    if (new URL(url).pathname.endsWith('/media') && failures-- > 0) throw new TypeError('fetch failed');
    return f.fetcher(url, init);
  } });
  d.bind(server, profile);
  const item = await d.add(selection);
  await until(() => d.item(item.id).retryAt > 0);
  assert.equal(d.list().items[0].status, 'queued');
  assert.match(d.list().items[0].error, /fetch failed/);
  await until(() => ['complete', 'failed'].includes(d.item(item.id).status));
  assert.equal(d.item(item.id).status, 'complete', d.item(item.id).error);
});

test('interrupted downloads resume when the profile connects again', async (t) => {
  const f = await fixture(t); f.slow = true;
  const item = await f.downloads.add(selection);
  await until(() => f.downloads.item(item.id).received >= 2048);
  f.downloads.shutdown();
  await until(() => !f.downloads.active);
  const reopened = f.create();
  assert.equal(reopened.list().items[0].status, 'paused');
  assert.equal(reopened.list().items[0].resumeOnConnect, true);
  reopened.bind(server, profile);
  await until(() => reopened.item(item.id).status === 'downloading');
  await reopened.pauseAll();
  assert.equal(reopened.item(item.id).status, 'paused');
  assert.equal(reopened.list().items[0].resumeOnConnect, false);
  f.slow = false; reopened.resumeAll();
  await until(() => ['complete', 'failed'].includes(reopened.item(item.id).status));
  assert.equal(reopened.item(item.id).status, 'complete', reopened.item(item.id).error);
  assert.deepEqual(await fs.readFile(path.join(reopened.folder(item), 'video.track')), f.bytes.video);
});

test('downloads a whole Plex file with prepared ASS subtitles and plays it progressively', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanoos-downloads-plex-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const id = `${'a'.repeat(40)}.m.4`;
  const body = Buffer.alloc(8192, 7);
  let pending = 2;
  const plan = () => ({ duration: 120, tracks: [], files: [{ id: 'part-44', label: 'Original · 1080p', mimeType: 'video/x-matroska', container: 'mkv', audio: 'Japanese', bytes: body.length, url: '/api/b/plex/public/file/ticket' }], subtitles: [{ id: '7', locale: 'en', label: 'English', format: 'ass', url: '/api/b/plex/public/text-subtitle/s' }, { id: '8', locale: 'en', label: 'English', format: 'vtt', url: '/api/b/plex/public/text-subtitle/v' }] });
  const fetcher = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === `/api/v/plex/videos/${id}/download`) return Response.json(plan());
    if (u.pathname === `/api/v/plex/videos/${id}`) return Response.json({ video: { id, backend: 'plex', kind: 'movie', title: 'Test Movie', thumbnail: '', duration: 120 }, channel: { name: 'Test Movie' }, stream: {} });
    if (u.pathname.endsWith('/text-subtitle/s')) return pending-- > 0 ? Response.json({ pending: true }, { status: 202 }) : new Response('[Script Info]\n\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hi\n');
    if (u.pathname.endsWith('/file/ticket')) {
      const start = Number(/^bytes=(\d+)-$/.exec(init.headers?.range || '')?.[1] || 0);
      return new Response(body.subarray(start), { status: start ? 206 : 200, headers: { 'content-length': String(body.length - start), ...(start ? { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}) } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const d = new Downloads({ directory, fetch: fetcher });
  d.bind(server, profile);
  await assert.rejects(d.add({ backend: 'plex', videoId: 'not-a-plex-id', file: 'part-44', subtitles: [] }), /can’t be downloaded/);
  await assert.rejects(d.add({ backend: 'plex', videoId: id, file: 'part-44', subtitles: ['en\nEnglish\n99'] }), /no longer available/);
  const item = await d.add({ backend: 'plex', videoId: id, file: 'part-44', subtitles: ['en\nEnglish\n7'] });
  assert.equal(item.audio, 'Japanese');
  await until(() => ['complete', 'failed'].includes(d.item(item.id).status));
  assert.equal(d.item(item.id).status, 'complete', d.item(item.id).error);
  const detail = d.detail(item.id);
  assert.equal(detail.stream.dash, undefined);
  assert.ok(detail.stream.progressive.endsWith('/media.track'));
  assert.equal(detail.stream.subtitles[0].format, 'ass');
  const media = await d.media(item.id, 'media.track', new Request(detail.stream.progressive, { headers: { range: 'bytes=0-9' } }));
  assert.equal(media.status, 206); assert.equal(media.headers.get('content-type'), 'video/x-matroska');
  const subtitle = await d.media(item.id, 'subtitle-0.ass', new Request(detail.stream.subtitles[0].url));
  assert.match(await subtitle.text(), /\[Events\]/);
  assert.equal((await d.media(item.id, 'manifest.mpd', new Request(detail.stream.progressive))).status, 404);
  assert.equal(d.list().items[0].backend, 'plex');
  await assert.rejects(d.add({ backend: 'plex', videoId: id, file: 'part-44', subtitles: [] }), /already in Downloads/);
});

test('saves a server conversion segment by segment, resumes after a dropped connection and plays it locally', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanoos-downloads-segments-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const id = `${'c'.repeat(40)}.m.331`;
  let session = 0, failAt = 3, released = 0;
  const seg = (rep, n) => Buffer.from(`${rep}:${n}:`.padEnd(64, 'x'));
  const mpd = (s) => `<?xml version="1.0" encoding="utf-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT0H0M23.5S"><Period start="PT0S" id="0"><AdaptationSet segmentAlignment="true"><SegmentTemplate timescale="1" duration="5" initialization="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/header" media="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/$Number$.m4s?a=1&amp;b=2" startNumber="0"></SegmentTemplate><Representation id="0" mimeType="video/mp4" codecs="avc1.640029" bandwidth="4679000" width="1920" height="1080"></Representation></AdaptationSet><AdaptationSet segmentAlignment="true"><SegmentTemplate timescale="1" duration="5" initialization="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/header" media="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/$Number$.m4s" startNumber="0"></SegmentTemplate><Representation id="1" mimeType="audio/mp4" codecs="mp4a.40.2" bandwidth="160000" audioSamplingRate="48000"></Representation></AdaptationSet></Period></MPD>`;
  const requested = [];
  const fetcher = async (url) => {
    const u = new URL(url);
    if (u.pathname === `/api/v/plex/videos/${id}/download`) { session++; return Response.json({ duration: 23.5, tracks: [], files: [], subtitles: [], conversions: [{ id: '4056:transcode-auto', audio: { id: '4056', label: '日本語 (AC3 Stereo)', locale: 'ja' }, quality: { id: 'transcode-auto', label: 'Original · 1080p', copy: true }, bitrate: 5_000_000, manifest: `/api/b/plex/public/play/p${session}/manifest.mpd`, release: `/api/b/plex/public/play/p${session}/release` }] }); }
    if (u.pathname === `/api/v/plex/videos/${id}`) return Response.json({ video: { id, backend: 'plex', kind: 'episode', title: 'Reborn', thumbnail: '', duration: 23.5, episode: { seriesId: 's', seriesTitle: 'Tokyo Revengers', season: 1, number: '1' } }, channel: { name: 'Tokyo Revengers' }, stream: {} });
    if (u.pathname.endsWith('/manifest.mpd')) return new Response(mpd(session));
    if (u.pathname.endsWith('/release')) { released++; return Response.json({ ok: true }); }
    const m = /session\/(\d+)\/(\d)\/(header|\d+)\.?m?4?s?$/.exec(u.pathname);
    if (m) {
      requested.push(`${m[1]}/${m[2]}/${m[3]}`);
      if (m[3] === String(failAt) && m[2] === '0') { failAt = -1; throw new TypeError('fetch failed'); }
      return new Response(seg(m[2], m[3]));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const d = new Downloads({ directory, fetch: fetcher, retryDelays: [10] });
  d.bind(server, profile);
  const item = await d.add({ backend: 'plex', videoId: id, conversion: '4056:transcode-auto', subtitles: [] });
  assert.equal(item.audio, '日本語 (AC3 Stereo)');
  assert.equal(item.quality, 'Original · 1080p');
  await until(() => d.item(item.id).status === 'complete' || d.item(item.id).status === 'failed');
  assert.equal(d.item(item.id).status, 'complete', d.item(item.id).error);
  // 24 seconds in 5-second segments: header + 5 per representation. The retry reused earlier segments.
  for (const rep of ['0', '1']) for (const n of ['header', '0', '1', '2', '3', '4']) assert.ok(requested.some((r) => r.endsWith(`/${rep}/${n}`)), `${rep}/${n}`);
  assert.ok(!requested.some((r) => r.endsWith('/0/5')));
  assert.equal(requested.filter((r) => r.endsWith('/0/0')).length, 1);
  assert.ok(released >= 2);
  const detail = d.detail(item.id);
  assert.ok(detail.stream.dash.endsWith('/manifest.mpd'));
  const local = await (await d.media(item.id, 'manifest.mpd', new Request(detail.stream.dash))).text();
  assert.match(local, /initialization="s0-init.mp4" media="s0-\$Number\$.m4s"/);
  assert.match(local, /lang="ja"/);
  assert.doesNotMatch(local, /session|api/);
  const segment = await d.media(item.id, 's1-3.m4s', new Request(`${detail.stream.dash}`));
  assert.equal(segment.headers.get('content-type'), 'audio/mp4');
  assert.equal(await segment.text(), seg('1', '3').toString());
  assert.equal((await d.media(item.id, 's1-99.m4s', new Request(detail.stream.dash))).status, 404);
});
