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

// Fragmented MP4 just detailed enough for timing: an init segment with the track's timescale, and
// media segments of one sample spanning the segment.
const box = (type, ...parts) => { const body = Buffer.concat(parts); const head = Buffer.alloc(8); head.writeUInt32BE(body.length + 8); head.write(type, 4, 'latin1'); return Buffer.concat([head, body]); };
const u32 = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32BE(v, i * 4)); return b; };
const initSegment = (timescale) => box('ftyp', Buffer.from('iso6')), moovOf = (timescale) => box('moov', box('trak', box('mdia', box('mdhd', u32(0, 0, 0, timescale, 0, 0)))));
const mediaSegment = (start, duration, tag) => { const tfdt = Buffer.alloc(12); tfdt.writeUInt32BE(0x01000000); tfdt.writeBigUInt64BE(BigInt(start), 4); return Buffer.concat([box('moof', box('traf', box('tfhd', u32(0x020000, 1)), box('tfdt', tfdt), box('trun', u32(0x000100, 1, duration)))), box('mdat', Buffer.from(tag))]); };

test('saves a copied conversion by its real timeline: variable segments, restarts, a skip and the end', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanoos-downloads-segments-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const id = `${'c'.repeat(40)}.m.331`;
  // Keyframe-cut segments (seconds), like Plex copying HEVC: 60.5 s in 11 segments, not 13 × 5 s.
  const gops = [7, 3, 6, 9, 4, 8, 2.5, 6, 5, 4, 6];
  const starts = gops.map((_, i) => gops.slice(0, i).reduce((a, b) => a + b, 0));
  const duration = gops.reduce((a, b) => a + b, 0);
  const scales = { 0: 1000, 1: 48000 };
  let session = 0, released = 0, dropped = false, skipped = false;
  const sessions = new Map(); // per session and representation: next expected number and GOP
  const requested = [];
  const mpd = (s) => `<?xml version="1.0" encoding="utf-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT0H1M0.5S"><Period start="PT0S" id="0"><AdaptationSet segmentAlignment="true"><SegmentTemplate timescale="1" duration="5" initialization="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/header" media="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/$Number$.m4s" startNumber="0"></SegmentTemplate><Representation id="0" mimeType="video/mp4" codecs="hev1.2.1.L120" bandwidth="4679000" width="1440" height="1080"></Representation></AdaptationSet><AdaptationSet segmentAlignment="true"><SegmentTemplate timescale="1" duration="5" initialization="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/header" media="/api/b/plex/public/media/t${s}/video/:/transcode/universal/session/${s}/$RepresentationID$/$Number$.m4s" startNumber="0"></SegmentTemplate><Representation id="1" mimeType="audio/mp4" codecs="mp4a.40.2" bandwidth="160000" audioSamplingRate="48000"></Representation></AdaptationSet></Period></MPD>`;
  const fetcher = async (url) => {
    const u = new URL(url);
    if (u.pathname === `/api/v/plex/videos/${id}/download`) { session++; return Response.json({ duration, tracks: [], files: [], subtitles: [], conversions: [{ id: '4056:transcode-auto', audio: { id: '4056', label: '日本語 (EAC3 Stereo)', locale: 'ja' }, quality: { id: 'transcode-auto', label: 'Original · 1080p', copy: true, codec: 'hevc' }, bitrate: 5_000_000, manifest: `/api/b/plex/public/play/p${session}/manifest.mpd`, release: `/api/b/plex/public/play/p${session}/release` }] }); }
    if (u.pathname === `/api/v/plex/videos/${id}`) return Response.json({ video: { id, backend: 'plex', kind: 'episode', title: 'Reborn', thumbnail: '', duration, episode: { seriesId: 's', seriesTitle: 'Bleach', season: 1, number: '1' } }, channel: { name: 'Bleach' }, stream: {} });
    if (u.pathname.endsWith('/manifest.mpd')) return new Response(mpd(session));
    if (u.pathname.endsWith('/release')) { released++; return Response.json({ ok: true }); }
    const m = /session\/(\d+)\/(\d)\/(header|\d+)\.?m?4?s?$/.exec(u.pathname);
    if (!m) throw new Error(`Unexpected request: ${url}`);
    const [, s, rep, which] = m, scale = scales[rep];
    if (which === 'header') return new Response(Buffer.concat([initSegment(scale), moovOf(scale)]));
    const n = Number(which);
    requested.push(`${s}/${rep}/${n}`);
    if (rep === '0' && n === 4 && !dropped) { dropped = true; throw new TypeError('fetch failed'); }
    // Plex continues a session when asked for the next number; otherwise it restarts at the
    // keyframe before n × 5 s. Past the end it repeats the last segment.
    const key = `${s}/${rep}`, state = sessions.get(key);
    let gop = state && state.expect === n ? state.gop : Math.max(0, starts.findLastIndex((x) => x <= n * 5));
    // Once, the video skips a segment, as Plex sometimes does after restarting.
    if (rep === '0' && gop === 6 && !skipped) { skipped = true; gop = 7; }
    gop = Math.min(gop, gops.length - 1);
    sessions.set(key, { expect: n + 1, gop: gop + 1 });
    return new Response(mediaSegment(starts[gop] * scale, gops[gop] * scale, `${rep}:${gop}`));
  };
  const d = new Downloads({ directory, fetch: fetcher, retryDelays: [10] });
  d.bind(server, profile);
  const item = await d.add({ backend: 'plex', videoId: id, conversion: '4056:transcode-auto', subtitles: [] });
  assert.equal(item.quality, 'Original · 1080p');
  await until(() => d.item(item.id).status === 'complete' || d.item(item.id).status === 'failed', 10000);
  assert.equal(d.item(item.id).status, 'complete', d.item(item.id).error);
  assert.ok(dropped && skipped, 'the fake server dropped a connection and skipped a segment');
  assert.ok(released >= 2);
  // Past the end the server only repeats; the download stops after a few such answers.
  assert.ok(requested.length < 60, `${requested.length} requests`);
  const detail = d.detail(item.id);
  const local = await (await d.media(item.id, 'manifest.mpd', new Request(detail.stream.dash))).text();
  assert.doesNotMatch(local, /session|api|\$Number\$/);
  assert.match(local, /lang="ja"/);
  for (const [rep, scale] of Object.entries(scales)) {
    // Every segment once, in order, with its real start and length, covering the whole episode.
    const timeline = [...local.matchAll(new RegExp(`<Representation id="${rep}"[\\s\\S]*?</Representation>`, 'g'))][0][0];
    assert.match(timeline, new RegExp(`<SegmentList timescale="${scale}"><Initialization sourceURL="s${rep}-init.mp4"/>`));
    const entries = [...timeline.matchAll(/<S t="(\d+)" d="(\d+)"\/>/g)].map(([, a, b]) => [Number(a) / scale, Number(b) / scale]);
    assert.deepEqual(entries, gops.map((g, i) => [starts[i], g]));
    const urls = [...timeline.matchAll(/<SegmentURL media="([^"]+)"\/>/g)].map(([, u]) => u);
    assert.deepEqual(urls, starts.map((x) => `s${rep}-${x * scale}.m4s`));
    const served = await d.media(item.id, urls[6], new Request(detail.stream.dash));
    assert.equal(served.headers.get('content-type'), rep === '0' ? 'video/mp4' : 'audio/mp4');
    assert.ok((await served.arrayBuffer()).byteLength > 0);
  }
  // Only the playable segments are kept, and the size shown is exactly what's saved.
  const saved = (await fs.readdir(d.folder(d.item(item.id)))).filter((f) => f.endsWith('.m4s'));
  assert.equal(saved.length, gops.length * 2);
  assert.equal(d.item(item.id).total, d.item(item.id).received);
});

// A copied open-GOP segment as Plex muxes it: a keyframe, then leading pictures, one of which
// carries the keyframe's own presentation time (dts + composition offset).
const openGop = (start, frames, tag) => {
  const entries = frames.map(([duration, offset]) => u32(duration, 4, offset));
  const tfdt = Buffer.alloc(12); tfdt.writeUInt32BE(0x01000000); tfdt.writeBigUInt64BE(BigInt(start), 4);
  return Buffer.concat([box('moof', box('traf', box('tfhd', u32(0x020000, 1)), box('tfdt', tfdt), box('trun', u32(0x000b00, frames.length), ...entries))), box('mdat', Buffer.alloc(frames.length * 4, tag))]);
};
const leading = [[1032, 2016], [984, 1992], [1008, 0], [1008, 1008], [984, 4992]]; // frame 2 repeats frame 0's time

test('repairs a conversion saved by fixed-length numbers: real timeline, repeats skipped, keyframe times playable', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fanoos-downloads-repair-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const id = 'a'.repeat(32), scale = 24000;
  const folder = path.join(directory, 'offline-media', id);
  await fs.mkdir(folder, { recursive: true });
  // Three real segments (5016 ticks each), then the server's repeat of the last one past the end.
  const starts = [0, 5016, 10032];
  for (const index of [0, 1]) {
    await fs.writeFile(path.join(folder, `s${index}-init.mp4`), Buffer.concat([initSegment(scale), moovOf(scale)]));
    for (const [n, start] of [...starts, 10032].entries()) await fs.writeFile(path.join(folder, `s${index}-${n}.m4s`), openGop(start, leading, n));
  }
  const old = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-live:2011" mediaPresentationDuration="PT0.627S" minBufferTime="PT2S"><Period><AdaptationSet contentType="video" mimeType="video/mp4" segmentAlignment="true"><SegmentTemplate timescale="1" duration="5" startNumber="0" initialization="s0-init.mp4" media="s0-$Number$.m4s"/><Representation id="0" bandwidth="4679000" codecs="hev1.2.1.L120" width="1440" height="1080"/></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4" segmentAlignment="true" lang="ja"><SegmentTemplate timescale="1" duration="5" startNumber="0" initialization="s1-init.mp4" media="s1-$Number$.m4s"/><Representation id="1" bandwidth="160000" codecs="mp4a.40.2" audioSamplingRate="48000"/></AdaptationSet></Period></MPD>`;
  await fs.writeFile(path.join(folder, 'manifest.mpd'), old);
  const scope = require('node:crypto').createHash('sha256').update(`${server}\n${profile.id}`).digest('hex');
  const item = { id, scope, server, backend: 'plex', videoId: `${'c'.repeat(40)}.m.1`, status: 'complete', createdAt: 1, received: 1, total: 1, selection: { backend: 'plex', videoId: `${'c'.repeat(40)}.m.1`, conversion: '1:transcode-auto', subtitles: [] }, video: { id: `${'c'.repeat(40)}.m.1`, title: 'Old', duration: 0.627 }, files: { segments: { signature: 'old', sets: [{ mimeType: 'video/mp4' }, { mimeType: 'audio/mp4' }] } }, subtitles: [] };
  await fs.writeFile(path.join(directory, 'downloads.json'), JSON.stringify({ items: [item], states: {}, context: null }));
  const d = new Downloads({ directory, fetch: async () => { throw new TypeError('offline'); } });
  d.bind(server, profile);
  const local = await (await d.media(id, 'manifest.mpd', new Request('fanoos-offline://app/media/x/manifest.mpd'))).text();
  assert.match(local, /lang="ja"/);
  for (const index of [0, 1]) {
    const rep = [...local.matchAll(new RegExp(`<Representation id="${index}"[\\s\\S]*?</Representation>`, 'g'))][0][0];
    assert.deepEqual([...rep.matchAll(/<S t="(\d+)" d="(\d+)"\/>/g)].map(([, a, b]) => [Number(a), Number(b)]), starts.map((x) => [x, 5016]));
    assert.deepEqual([...rep.matchAll(/<SegmentURL media="([^"]+)"\/>/g)].map(([, u]) => u), [0, 1, 2].map((n) => `s${index}-${n}.m4s`));
  }
  // The keyframe moved one tick later, so no leading picture shares its time; nothing else changed.
  const fixed = await fs.readFile(path.join(folder, 's0-1.m4s')), original = openGop(5016, leading, 1);
  assert.equal(fixed.length, original.length);
  const offsetAt = fixed.indexOf(u32(1032, 4, 2016 + 1));
  assert.ok(offsetAt > 0, 'keyframe composition offset is 2017');
  assert.equal(Buffer.compare(fixed.subarray(offsetAt + 12), original.subarray(offsetAt + 12)), 0);
  // Once repaired, the journal records it and the manifest isn't rebuilt again.
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'downloads.json'), 'utf8')).items[0].files.segments.timed ?? d.item(id).files.segments.timed, 2);
});
