const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');
const { setTimeout: wait } = require('node:timers/promises');

const scopeOf = (server, profileId) => createHash('sha256').update(`${server}\n${profileId}`).digest('hex');
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const fingerprint = (t) => JSON.stringify([t.id, t.mimeType, t.codecs, t.bytes, t.revision, t.initRange, t.indexRange, t.width, t.height, t.fps]);
// Each backend's item ids, and the only core proxy path its media may be fetched from.
const backends = {
  youtube: { id: /^[\w-]{11}$/, media: '/api/b/youtube/public/media' },
  plex: { id: /^[a-fA-F0-9-]{8,48}\.m\.\d{1,12}$/, media: '/api/b/plex/public/file/', conversion: '/api/b/plex/public/play/', segments: '/api/b/plex/public/media/' },
};
const backendOf = (item) => item.backend || 'youtube';
/** A string is a YouTube id (the original bridge call); newer pages name the backend. */
function targetOf(value) {
  const target = typeof value === 'string' ? { backend: 'youtube', videoId: value } : { backend: value?.backend ?? 'youtube', videoId: value?.videoId };
  if (!Object.hasOwn(backends, target.backend) || typeof target.videoId !== 'string' || !backends[target.backend].id.test(target.videoId)) throw new Error('This video can’t be downloaded.');
  return target;
}
// YouTube captions keep the original locale/label key; others add the track id, since labels can repeat.
const captionKey = (s, backend) => backend === 'youtube' || !s.id ? `${s.locale}\n${s.label}` : `${s.locale}\n${s.label}\n${s.id}`;
const subtitleTypes = { vtt: 'text/vtt; charset=utf-8', ass: 'text/x-ssa; charset=utf-8' };
const fileTypes = /^video\/(mp4|webm|x-matroska)$/;
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, k, v]) => [k, v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")]));
const isoSeconds = (value) => { const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value || ''); return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : NaN; };
/**
 * A media server's live-profile DASH output: one SegmentTemplate per adaptation set, numbered
 * segments of a fixed duration. Anything else (timelines, multiple periods) isn't saved.
 */
function segmentedManifest(xmlText) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText) || (xmlText.match(/<Period[\s>]/g) || []).length !== 1 || /<SegmentTimeline/.test(xmlText)) throw new Error('The server returned an unsupported conversion.');
  const duration = isoSeconds(attributes(/<MPD[^>]*>/.exec(xmlText)?.[0] || '').mediaPresentationDuration);
  const sets = [...xmlText.matchAll(/<AdaptationSet([^>]*)>([\s\S]*?)<\/AdaptationSet>/g)].map(([, own, body]) => {
    const template = attributes(/<SegmentTemplate[^>]*>/.exec(body)?.[0] || '');
    const reps = [...body.matchAll(/<Representation[^>]*>/g)].map((m) => attributes(m[0]));
    const rep = reps[0] || {}, set = attributes(own);
    const mimeType = rep.mimeType || set.mimeType;
    const value = { id: rep.id, mimeType, codecs: rep.codecs || set.codecs, bandwidth: Number(rep.bandwidth), width: Number(rep.width) || undefined, height: Number(rep.height) || undefined, sampleRate: Number(rep.audioSamplingRate) || undefined, timescale: Number(template.timescale || 1), segment: Number(template.duration), start: Number(template.startNumber || 1), init: template.initialization, media: template.media };
    if (reps.length !== 1 || !/^[\w.-]{1,32}$/.test(value.id || '') || !/^(video|audio)\/mp4$/.test(mimeType || '') || !/^[\w.-]+$/.test(value.codecs || '') || !(value.bandwidth > 0) || !(value.timescale > 0) || !(value.segment > 0) || !Number.isSafeInteger(value.start) || !value.init || !value.media?.includes('$Number$')) throw new Error('The server returned an unsupported conversion.');
    for (const key of ['init', 'media']) value[key] = value[key].replaceAll('$RepresentationID$', value.id);
    return value;
  });
  if (!(duration > 0) || !sets.some((x) => x.mimeType.startsWith('video/')) || !sets.some((x) => x.mimeType.startsWith('audio/'))) throw new Error('The server returned an unsupported conversion.');
  return { duration, sets };
}
const segmentName = (index, n) => n === 'init' ? `s${index}-init.mp4` : `s${index}-${n}.m4s`;
function boxes(buf, start = 0, end = buf.length) {
  const found = [];
  for (let p = start; p + 8 <= end;) {
    let size = buf.readUInt32BE(p), header = 8;
    if (size === 1 && p + 16 <= end) { size = Number(buf.readBigUInt64BE(p + 8)); header = 16; }
    if (size < header || p + size > end) break;
    found.push({ type: buf.toString('latin1', p + 4, p + 8), start: p + header, end: p + size, at: p });
    p += size;
  }
  return found;
}
const child = (buf, box, type) => box && boxes(buf, box.start, box.end).find((b) => b.type === type);
/** The media timescale of an init segment's track. */
function trackTimescale(init) {
  const mdhd = child(init, child(init, child(init, boxes(init).find((b) => b.type === 'moov'), 'trak'), 'mdia'), 'mdhd');
  if (!mdhd) throw new Error('The server returned an unreadable segment.');
  return init.readUInt32BE(mdhd.start + (init[mdhd.start] === 1 ? 20 : 12));
}
/** Start and length of a fragmented-MP4 segment, in its track's timescale. */
function fragmentTiming(buf) {
  let start = null, duration = 0;
  for (const moof of boxes(buf).filter((b) => b.type === 'moof')) for (const traf of boxes(buf, moof.start, moof.end).filter((b) => b.type === 'traf')) {
    const kids = boxes(buf, traf.start, traf.end), tfhd = kids.find((b) => b.type === 'tfhd'), tfdt = kids.find((b) => b.type === 'tfdt');
    if (!tfhd || !tfdt) continue;
    const flags = buf.readUInt32BE(tfhd.start) & 0xffffff;
    let q = tfhd.start + 8; if (flags & 1) q += 8; if (flags & 2) q += 4;
    const fallback = flags & 8 ? buf.readUInt32BE(q) : 0;
    if (start === null) start = buf[tfdt.start] === 1 ? Number(buf.readBigUInt64BE(tfdt.start + 4)) : buf.readUInt32BE(tfdt.start + 4);
    for (const trun of kids.filter((b) => b.type === 'trun')) {
      const f = buf.readUInt32BE(trun.start) & 0xffffff, samples = buf.readUInt32BE(trun.start + 4);
      let r = trun.start + 8; if (f & 1) r += 4; if (f & 4) r += 4;
      const stride = [0x100, 0x200, 0x400, 0x800].filter((bit) => f & bit).length * 4;
      for (let i = 0; i < samples; i++, r += stride) duration += f & 0x100 ? buf.readUInt32BE(r) : fallback;
    }
  }
  if (start === null || !(duration > 0)) throw new Error('The server returned an unreadable segment.');
  return { t: start, d: duration };
}
/**
 * A media server copying open-GOP video (HEVC with leading pictures) can stamp a leading picture
 * with its keyframe's own presentation time. Chromium then drops the keyframe and the whole
 * segment that depends on it. Moving the keyframe one tick later keeps every frame (the leading
 * picture belongs just before it). Patches `buf` in place; true when it changed.
 */
function fixKeyframeTime(buf) {
  const moof = boxes(buf).find((b) => b.type === 'moof'), trun = child(buf, child(buf, moof, 'traf'), 'trun');
  if (!trun) return false;
  const flags = buf.readUInt32BE(trun.start) & 0xffffff, count = buf.readUInt32BE(trun.start + 4), signed = buf[trun.start] === 1;
  if (!(flags & 0x800) || !(flags & 0x100) || count < 2) return false;
  let at = trun.start + 8 + (flags & 1 ? 4 : 0) + (flags & 4 ? 4 : 0);
  const stride = [0x100, 0x200, 0x400, 0x800].filter((bit) => flags & bit).length * 4, offset = stride - 4;
  if (at + count * stride > buf.length) return false;
  const cto = (i) => signed ? buf.readInt32BE(at + i * stride + offset) : buf.readUInt32BE(at + i * stride + offset);
  let dts = 0; const times = [];
  for (let i = 0; i < count; i++) { times.push(dts + cto(i)); dts += buf.readUInt32BE(at + i * stride); }
  if (!times.slice(1).includes(times[0])) return false;
  signed ? buf.writeInt32BE(cto(0) + 1, at + offset) : buf.writeUInt32BE(cto(0) + 1, at + offset);
  return true;
}
/** Applies fixKeyframeTime to a saved segment, rewriting only its first bytes. */
async function fixSegment(file) {
  const handle = await fsp.open(file, 'r+');
  try {
    const buf = Buffer.alloc(256 * 1024), { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const headBytes = buf.subarray(0, bytesRead);
    if (fixKeyframeTime(headBytes)) await handle.write(headBytes, 0, headBytes.length, 0);
  } finally { await handle.close(); }
}
/** A segment's first bytes: its moof (timing) comes before the media data. */
async function head(file) {
  const handle = await fsp.open(file, 'r');
  try { const buf = Buffer.alloc(256 * 1024); const { bytesRead } = await handle.read(buf, 0, buf.length, 0); return buf.subarray(0, bytesRead); }
  finally { await handle.close(); }
}
/**
 * The playable timeline from segments in any order: by start time, without those that only repeat
 * time already covered (a server restarting its conversion sends some again), and each declared
 * up to where the next begins. `holes` is time no segment covers.
 */
function playable(entries, slack) {
  const kept = [], holes = [];
  let covered = 0;
  for (const e of [...entries].sort((a, b) => a.t - b.t || b.d - a.d)) {
    if (e.t + e.d <= covered + slack) continue;
    if (e.t > covered + slack) holes.push([covered, e.t]);
    const last = kept.at(-1);
    if (last && e.t < last.t + last.d) { last.d = e.t - last.t; if (last.d <= 0) kept.pop(); }
    kept.push({ ...e });
    covered = e.t + e.d;
  }
  return { kept, holes, covered };
}
/**
 * The saved segments as an on-demand manifest that points at local files. With measured timelines,
 * segments are listed with their real times; segments of a copied video vary in length.
 */
function localManifest({ duration, sets }, language) {
  const segments = (x, i) => x.timeline
    ? `<SegmentList timescale="${x.timeline.timescale}"><Initialization sourceURL="${segmentName(i, 'init')}"/><SegmentTimeline>${x.timeline.entries.map((e) => `<S t="${e.t}" d="${e.d}"/>`).join('')}</SegmentTimeline>${x.timeline.entries.map((e) => `<SegmentURL media="${segmentName(i, e.n)}"/>`).join('')}</SegmentList>`
    : `<SegmentTemplate timescale="${x.timescale}" duration="${x.segment}" startNumber="${x.start}" initialization="${segmentName(i, 'init')}" media="s${i}-$Number$.m4s"/>`;
  const set = (x, i) => `<AdaptationSet contentType="${x.mimeType.split('/')[0]}" mimeType="${xml(x.mimeType)}" segmentAlignment="true"${x.mimeType.startsWith('audio/') && language ? ` lang="${xml(language)}"` : ''}><Representation id="${i}" bandwidth="${x.bandwidth}" codecs="${xml(x.codecs)}"${x.width ? ` width="${x.width}" height="${x.height}"` : ''}${x.sampleRate ? ` audioSamplingRate="${x.sampleRate}"` : ''}>${segments(x, i)}</Representation></AdaptationSet>`;
  return `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:full:2011" mediaPresentationDuration="PT${duration}S" minBufferTime="PT2S"><Period>${sets.map(set).join('')}</Period></MPD>`;
}
/** Network drops, timeouts and server errors are worth retrying on their own; other failures need the viewer. */
const failure = (message, status) => Object.assign(new Error(message), { transient: status >= 500 || status === 408 || status === 429 });
const isTransient = (error) => error?.transient === true || error instanceof TypeError || error?.name === 'TimeoutError';

function manifest(duration, video, audio) {
  const set = (t, name) => `<AdaptationSet contentType="${t.kind}" mimeType="${xml(t.mimeType)}"${t.language ? ` lang="${xml(t.language)}"` : ''}><Label>${xml(t.label)}</Label><Representation id="${xml(t.id)}" bandwidth="${t.bandwidth}" codecs="${xml(t.codecs)}"${t.width ? ` width="${t.width}" height="${t.height}" frameRate="${t.fps || 30}"` : ''}${t.sampleRate ? ` audioSamplingRate="${t.sampleRate}"` : ''}>${t.channels ? `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${t.channels}"/>` : ''}<BaseURL>${name}.track</BaseURL><SegmentBase indexRange="${xml(t.indexRange)}"><Initialization range="${xml(t.initRange)}"/></SegmentBase></Representation></AdaptationSet>`;
  return `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:full:2011" mediaPresentationDuration="PT${duration}S" minBufferTime="PT1.5S"><Period>${set(video, 'video')}${set(audio, 'audio')}</Period></MPD>`;
}

/** Range-aware local responses: DASH reads the index and then seeks through each track. */
async function serveFile(file, type, request, headers = {}) {
  const size = (await fsp.stat(file)).size;
  let start = 0, end = size - 1, status = 200;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}`, ...headers } });
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}`, ...headers } });
    status = 206;
  }
  const out = { ...headers, 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(Math.max(0, end - start + 1)), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (status === 206) out['content-range'] = `bytes ${start}-${end}/${size}`;
  return new Response(request.method === 'HEAD' || !size ? null : Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers: out });
}

class Downloads {
  constructor({ directory, fetch: fetcher, notify = () => {}, completed = () => {}, retryDelays = [5000, 30000, 120000, 300000, 600000] }) {
    this.directory = directory;
    this.root = path.join(directory, 'offline-media');
    this.journal = path.join(directory, 'downloads.json');
    this.fetch = fetcher;
    this.notify = notify;
    this.completed = completed;
    this.retryDelays = retryDelays;
    this.rates = new Map();
    this.meters = new Map();
    fs.mkdirSync(this.root, { recursive: true });
    try { this.data = JSON.parse(fs.readFileSync(this.journal, 'utf8')); } catch { this.data = { items: [], states: {}, context: null }; }
    delete this.data.limitBytes; // Discard the retired per-device cap from older journals.
    this.context = this.data.context;
    // Interrupted by quitting: continue once the same profile connects again.
    for (const item of this.data.items) if (['queued', 'downloading'].includes(item.status)) { item.status = 'paused'; item.resumeOnConnect = true; item.retryAt = undefined; item.error = undefined; }
    this.active = null;
    this.save();
  }
  save() {
    fs.writeFileSync(`${this.journal}.tmp`, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(`${this.journal}.tmp`, this.journal);
    this.notify();
  }
  bind(server, profile) {
    const next = { server, profileId: profile.id, profileName: profile.name, scope: scopeOf(server, profile.id) };
    if (this.context?.scope !== next.scope && this.active) { this.data.items.find((i) => i.id === this.active.id).resumeOnConnect = true; this.active.controller.abort(); }
    this.context = this.data.context = next;
    for (const item of this.data.items) if (item.scope === next.scope && item.status === 'paused' && item.resumeOnConnect) { item.status = 'queued'; item.resumeOnConnect = false; }
    this.save();
    this.pump();
  }
  async lock(remove = false) {
    const scope = this.context?.scope;
    for (const item of this.data.items) if (item.scope === scope && ['queued', 'downloading'].includes(item.status)) { item.status = 'paused'; item.resumeOnConnect = true; item.retryAt = undefined; }
    const active = this.active;
    this.context = this.data.context = null;
    if (active) { active.controller.abort(); await active.done; }
    if (remove && scope) {
      for (const item of this.data.items.filter((x) => x.scope === scope)) await fsp.rm(this.folder(item), { recursive: true, force: true });
      this.data.items = this.data.items.filter((x) => x.scope !== scope);
      delete this.data.states[scope];
    }
    this.save();
  }
  requireContext() { if (!this.context) throw new Error('Connect and sign in to your Fanoos server first.'); return this.context; }
  item(id) {
    const ctx = this.requireContext();
    const item = this.data.items.find((x) => x.id === id && x.scope === ctx.scope);
    if (!item) throw new Error('Download not found for this profile.');
    return item;
  }
  folder(item) { return path.join(this.root, item.id); }
  used() { return this.data.items.reduce((n, i) => n + i.received, 0); }
  free() { const disk = fs.statfsSync(this.root); return Number(disk.bavail) * Number(disk.bsize); }
  view(item) {
    const { id, videoId, video, channel, status, quality, audio, received, total, createdAt, downloadedAt, warning, retryAt } = item;
    const speed = this.active?.id === id ? this.rates.get(id) : undefined;
    return { id, videoId, backend: backendOf(item), status, quality, audio, received, total, createdAt, downloadedAt, warning, speed, retryAt: status === 'queued' ? retryAt : undefined, resumeOnConnect: status === 'paused' && Boolean(item.resumeOnConnect), error: status === 'failed' || (status === 'queued' && retryAt) ? item.error : undefined, video: { ...video, thumbnail: item.hasThumbnail ? `fanoos-offline://app/media/${id}/thumbnail` : video.thumbnail }, channel: { ...channel, avatar: item.hasAvatar ? `fanoos-offline://app/media/${id}/channel-avatar` : channel.avatar } };
  }
  list() {
    return { items: this.data.items.filter((i) => i.scope === this.context?.scope).map((i) => this.view(i)), usedBytes: this.used(), freeBytes: this.free(), totalDiskBytes: (() => { const disk = fs.statfsSync(this.root); return Number(disk.blocks) * Number(disk.bsize); })(), profileName: this.context?.profileName ?? '', server: this.context?.server ?? '' };
  }
  async request(server, resource, init = {}) {
    const url = new URL(resource, server);
    if (url.origin !== server || !url.pathname.startsWith('/api/')) throw new Error('Download source must be on your Fanoos server.');
    return this.fetch(url.href, { ...init, credentials: 'include', redirect: 'error' });
  }
  async json(server, resource, signal) {
    const res = await this.request(server, resource, { signal: signal ?? AbortSignal.timeout(90000) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw failure(body.error || `Server returned ${res.status}. Reconnect and try again.`, res.status); }
    return res.json();
  }
  async plan(value, signal, context = this.requireContext()) {
    const { backend, videoId } = targetOf(value);
    return this.json(context.server, `/api/v/${backend}/videos/${videoId}/download`, signal);
  }
  async add(selection) {
    const { backend, videoId } = targetOf(selection);
    const dash = typeof selection.videoTrack === 'string' && typeof selection.audioTrack === 'string' && selection.file === undefined && selection.conversion === undefined;
    const converted = typeof selection.conversion === 'string' && selection.file === undefined && !dash;
    if ((!dash && !converted && typeof selection.file !== 'string') || !Array.isArray(selection.subtitles) || selection.subtitles.length > 20 || selection.subtitles.some((s) => typeof s !== 'string')) throw new Error('Invalid download selection.');
    const ctx = this.requireContext();
    const same = (i) => i.scope === ctx.scope && backendOf(i) === backend && i.videoId === videoId;
    if (this.data.items.some(same)) throw new Error('This video is already in Downloads. Remove it before choosing another quality.');
    const [plan, detail] = await Promise.all([this.plan({ backend, videoId }), this.json(ctx.server, `/api/v/${backend}/videos/${videoId}`)]);
    if (this.context?.scope !== ctx.scope) throw new Error('Your active profile changed. Try again.');
    if (detail.stream?.drm || detail.video.live || detail.video.upcoming) throw new Error('Only unencrypted on-demand videos can be downloaded.');
    let estimate, quality, audioLabel;
    if (dash) {
      const video = plan.tracks.find((t) => t.id === selection.videoTrack && t.kind === 'video');
      const audio = plan.tracks.find((t) => t.id === selection.audioTrack && t.kind === 'audio');
      if (!video || !audio) throw new Error('These tracks are no longer available. Choose your download quality again.');
      estimate = (video.bytes || video.bandwidth * plan.duration / 8) + (audio.bytes || audio.bandwidth * plan.duration / 8);
      quality = video.label; audioLabel = audio.label;
    } else if (converted) {
      const conversion = plan.conversions?.find((c) => c.id === selection.conversion);
      if (!conversion) throw new Error('This audio and quality are no longer available. Choose your download again.');
      estimate = conversion.bitrate * plan.duration / 8; quality = conversion.quality.label; audioLabel = conversion.audio.label;
    } else {
      const file = plan.files?.find((f) => f.id === selection.file);
      if (!file) throw new Error('This file is no longer available. Choose your download again.');
      estimate = file.bytes; quality = file.label; audioLabel = file.audio || file.audioCodec?.toUpperCase() || 'Original audio';
    }
    if (estimate + 64 * 1024 ** 2 > this.free()) throw new Error(`There is not enough free disk space for this download. It needs about ${Math.ceil(estimate / 1024 ** 2)} MB.`);
    const item = {
      id: randomBytes(16).toString('hex'), scope: ctx.scope, server: ctx.server, profileId: ctx.profileId,
      backend, videoId, selection: { ...selection, backend }, video: detail.video, channel: detail.channel,
      captionSelections: selection.subtitles.map((key) => plan.subtitles.find((s) => captionKey(s, backend) === key)),
      status: 'queued', quality, audio: audioLabel, received: 0, total: Math.ceil(estimate), createdAt: Date.now(), files: {},
    };
    if (item.captionSelections.some((s) => !s || !subtitleTypes[s.format] || s.render === 'server')) throw new Error('Selected subtitles are no longer available.');
    // The async metadata requests above may overlap another add.
    if (this.data.items.some(same)) throw new Error('This video is already in Downloads.');
    fs.mkdirSync(this.folder(item));
    this.data.items.unshift(item); this.save(); this.pump();
    return this.view(item);
  }
  /** One transfer at a time, oldest first; items waiting to retry are skipped until due. */
  pump() {
    if (this.active || !this.context) return;
    const now = Date.now();
    const waiting = this.data.items.filter((i) => i.scope === this.context.scope && i.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    const item = waiting.find((i) => !(i.retryAt > now));
    clearTimeout(this.retryTimer);
    if (!item) {
      const due = Math.min(...waiting.map((i) => i.retryAt));
      if (Number.isFinite(due)) { this.retryTimer = setTimeout(() => this.pump(), due - now); this.retryTimer.unref?.(); }
      return;
    }
    const controller = new AbortController();
    this.active = { id: item.id, controller, done: null };
    this.active.done = this.run(item, controller.signal).catch((error) => {
      const attempt = (item.retries ?? 0) + 1;
      if (controller.signal.aborted) { if (item.status === 'downloading') item.status = 'paused'; item.error = undefined; }
      else if (isTransient(error) && attempt <= this.retryDelays.length) { item.status = 'queued'; item.retries = attempt; item.retryAt = Date.now() + this.retryDelays[attempt - 1]; item.error = error.message; }
      else { item.status = 'failed'; item.error = error.message; }
      this.save();
    }).finally(() => { this.active = null; this.rates.delete(item.id); this.meters.delete(item.id); this.pump(); });
  }
  async stop(items) {
    for (const item of items) { item.status = 'paused'; item.resumeOnConnect = false; item.retryAt = undefined; }
    const active = this.active;
    if (active && items.some((i) => i.id === active.id)) { active.controller.abort(); await active.done; }
    this.save();
  }
  pause(id) { return this.stop([this.item(id)]); }
  pauseAll() { const scope = this.requireContext().scope; return this.stop(this.data.items.filter((i) => i.scope === scope && ['queued', 'downloading'].includes(i.status))); }
  queue(items) {
    for (const item of items) { item.status = 'queued'; item.error = undefined; item.retries = 0; item.retryAt = undefined; item.resumeOnConnect = false; }
    this.save(); this.pump();
  }
  resume(id) { const item = this.item(id); if (item.status === 'complete' || this.active?.id === id) return; this.queue([item]); }
  resumeAll() { const scope = this.requireContext().scope; this.queue(this.data.items.filter((i) => i.scope === scope && (['paused', 'failed'].includes(i.status) || (i.status === 'queued' && i.retryAt)))); }
  async remove(id) { const item = this.item(id); await this.pause(id); await fsp.rm(this.folder(item), { recursive: true, force: true }); this.data.items = this.data.items.filter((i) => i.id !== id); this.save(); }
  async recount(item) {
    const files = await fsp.readdir(this.folder(item));
    item.received = (await Promise.all(files.filter((f) => !f.endsWith('.mpd')).map(async (f) => (await fsp.stat(path.join(this.folder(item), f))).size))).reduce((a, b) => a + b, 0);
  }
  track(item, track, name, signal) {
    if (!track || !Number.isFinite(track.bandwidth) || track.bandwidth <= 0 || !/^(video|audio)\/(mp4|webm)$/.test(track.mimeType) || !/^[0-9]+-[0-9]+$/.test(track.initRange) || !/^[0-9]+-[0-9]+$/.test(track.indexRange)) throw new Error('The server returned an unsupported media track.');
    return this.transfer(item, { url: track.url, bytes: track.bytes, type: track.mimeType, signature: fingerprint(track) }, name, signal);
  }
  file(item, file, signal) {
    if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !fileTypes.test(file.mimeType)) throw new Error('The server returned an unsupported media file.');
    return this.transfer(item, { url: file.url, bytes: file.bytes, type: file.mimeType, signature: JSON.stringify([file.id, file.bytes, file.mimeType, file.container]) }, 'media', signal);
  }
  /** Resumable byte-range transfer into <name>.track; a changed source starts over. */
  async transfer(item, track, name, signal) {
    const source = new URL(track.url, item.server);
    if (source.origin !== item.server || !source.pathname.startsWith(backends[backendOf(item)].media)) throw new Error('Invalid media source.');
    const dest = path.join(this.folder(item), `${name}.track`), partial = `${dest}.part`;
    const signature = track.signature;
    if (item.files[name]?.signature !== signature || !track.bytes) {
      await fsp.rm(dest, { force: true }); await fsp.rm(partial, { force: true });
      item.files[name] = { signature, type: track.type };
      await this.recount(item);
    }
    if (fs.existsSync(dest)) {
      if (track.bytes && (await fsp.stat(dest)).size === track.bytes) return;
      await fsp.rm(dest, { force: true });
    }
    let offset = fs.existsSync(partial) ? (await fsp.stat(partial)).size : 0;
    if (track.bytes && offset === track.bytes) { await fsp.rename(partial, dest); return; }
    if (track.bytes && offset > track.bytes) { await fsp.truncate(partial, 0); offset = 0; }
    const get = () => this.request(item.server, track.url, { signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
    let res = await get();
    if (offset && res.status !== 206) {
      await res.body?.cancel(); await fsp.truncate(partial, 0); offset = 0; await this.recount(item); res = await get();
    }
    if (!res.ok || !res.body) { await res.body?.cancel(); throw failure(`Media transfer failed (${res.status}). Resume to obtain fresh stream URLs.`, res.status); }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') || '');
    if (res.status === 206 && (!range || Number(range[1]) !== offset || (track.bytes && Number(range[3]) !== track.bytes))) { await res.body.cancel(); throw new Error('The server returned an unexpected byte range. Retry the download.'); }
    const expected = range ? Number(range[3]) : Number(res.headers.get('content-length')) + offset;
    if (track.bytes && expected && expected !== track.bytes) { await res.body.cancel(); throw new Error('This media track changed. Remove the download and select it again.'); }
    offset += await this.write(item, res.body, partial, signal);
    if (!offset || (track.bytes && offset !== track.bytes) || (expected && offset !== expected)) throw new Error('The transfer ended before the media file was complete. Resume to retry.');
    await fsp.rename(partial, dest);
    this.save();
  }
  /** Appends a response body to a file, counting progress and transfer rate, and minding free space. */
  async write(item, body, file, signal) {
    const handle = await fsp.open(file, 'a');
    let length = 0, space = 0;
    const meter = this.meters.get(item.id) ?? { last: Date.now(), since: 0 };
    this.meters.set(item.id, meter);
    try {
      for await (const chunk of body) {
        signal.throwIfAborted();
        // statfs is cheap but not free: check again only after the last reading's headroom is used.
        if (space < chunk.byteLength + 32 * 1024 ** 2) { space = this.free(); if (space < chunk.byteLength + 32 * 1024 ** 2) throw new Error('Download storage is full. Free some space, then resume.'); }
        let written = 0;
        while (written < chunk.byteLength) { const result = await handle.write(chunk, written, chunk.byteLength - written); written += result.bytesWritten; }
        length += chunk.byteLength; item.received += chunk.byteLength; meter.since += chunk.byteLength; space -= chunk.byteLength;
        const now = Date.now();
        if (now - meter.last > 500) {
          const rate = meter.since / ((now - meter.last) / 1000), old = this.rates.get(item.id);
          this.rates.set(item.id, old ? old * 0.7 + rate * 0.3 : rate);
          meter.since = 0; meter.last = now; this.save();
        }
      }
    } finally { await handle.close(); }
    return length;
  }
  /**
   * Saves a server conversion segment by segment. Finished segments are kept, so a resumed
   * download asks a fresh session for the rest; segments carry their own timestamps.
   */
  async segments(item, conversion, signal) {
    const conf = backends[backendOf(item)];
    const source = new URL(conversion.manifest, item.server);
    if (!conf.conversion || source.origin !== item.server || !source.pathname.startsWith(conf.conversion)) throw new Error('Invalid media source.');
    const res = await this.request(item.server, conversion.manifest, { signal });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw failure(body.error || `The server couldn't start the conversion (${res.status}).`, res.status); }
    const mpd = segmentedManifest(await res.text());
    for (const set of mpd.sets) for (const key of ['init', 'media']) {
      const url = new URL(set[key], item.server);
      if (url.origin !== item.server || !url.pathname.startsWith(conf.segments)) throw new Error('Invalid media source.');
    }
    // v2: segments are saved under their start time. Earlier downloads used the server's numbers.
    const signature = JSON.stringify(['v2', conversion.id, mpd.sets.map((x) => [x.mimeType, x.codecs, x.timescale, x.segment, x.start])]);
    const folder = this.folder(item);
    if (item.files.segments?.signature !== signature) {
      // A different conversion than the saved segments: start over.
      for (const name of await fsp.readdir(folder)) if (/^s\d+-/.test(name)) await fsp.rm(path.join(folder, name), { force: true });
      item.files = { segments: { signature, sets: mpd.sets.map(({ mimeType }) => ({ mimeType })) } };
      await this.recount(item);
    }
    const fetchTo = async (url, dest, at) => {
      const response = await this.request(item.server, url, { signal });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(`The conversion stopped at ${Math.round(at)}s (${response.status}). Resume to continue from there.`, response.status); }
      await fsp.rm(`${dest}.part`, { force: true });
      if (!await this.write(item, response.body, `${dest}.part`, signal)) throw failure('The server returned an empty segment. Resume to retry.', 502);
      return `${dest}.part`;
    };
    const progress = mpd.sets.map((set) => ({ covered: 0, bytes: 0, end: 1, estimate: set.bandwidth * mpd.duration / 8 }));
    const project = () => {
      // The manifest's bandwidth is an average that a copied video's real size can be far from:
      // once some of a stream is saved, project its size from what's saved.
      item.total = Math.max(item.received, Math.ceil(progress.reduce((n, p) => n + (p.covered > 0.02 * p.end ? p.bytes / p.covered * p.end : p.estimate), 0)));
    };
    /**
     * One stream, moving through the presentation by time. A copied video's segments are cut at
     * keyframes, so they vary in length and the server's segment numbers aren't times; asking for
     * a number the server doesn't expect makes it restart there, sending time again or skipping
     * some. Each segment is saved under its own start time, holes are filled by asking again
     * from before them, and the stream ends where the presentation does.
     */
    const stream = async (set, index) => {
      const initPath = path.join(folder, segmentName(index, 'init'));
      if (!fs.existsSync(initPath)) await fsp.rename(await fetchTo(set.init, initPath, 0), initPath);
      const timescale = trackTimescale(await fsp.readFile(initPath));
      const seconds = set.segment / set.timescale, slack = 0.05 * timescale, end = mpd.duration * timescale;
      const entries = new Map();
      for (const name of await fsp.readdir(folder)) {
        const m = new RegExp(`^s${index}-(\\d+)\\.m4s$`).exec(name);
        if (!m) continue;
        try { entries.set(Number(m[1]), { n: Number(m[1]), ...fragmentTiming(await head(path.join(folder, name))), bytes: (await fsp.stat(path.join(folder, name))).size }); }
        catch { await fsp.rm(path.join(folder, name), { force: true }); }
      }
      const at = () => playable([...entries.values()], slack);
      const tally = () => { const { kept, covered } = at(); Object.assign(progress[index], { covered, end, bytes: kept.reduce((n, e) => n + entries.get(e.n).bytes, 0) }); project(); };
      tally();
      // Resume from the segment that covers where saved time ends.
      let n = Math.max(set.start, Math.floor(at().covered / timescale / seconds));
      let steps = 0, idle = 0, retreat = null;
      for (;;) {
        const { covered, holes } = at();
        // A final frame can end slightly before the stated duration.
        if (!holes.length && covered >= end - timescale) break;
        // Ask again from before a hole, once; the answers then move forward through it. If they
        // pass it without filling it, step back again.
        if (holes.length && (retreat?.[0] !== holes[0][0] || n * seconds * timescale > holes[0][1] + 2 * seconds * timescale)) {
          retreat = holes[0];
          n = Math.max(set.start, Math.floor(holes[0][0] / timescale / seconds) - 1);
        }
        if (++steps > 3 * Math.ceil(mpd.duration / seconds) + 20) throw failure('The server kept sending parts of this video out of order. Resume to try again.', 502);
        const part = await fetchTo(set.media.replaceAll('$Number$', String(n)), path.join(folder, `s${index}-next.m4s`), n * seconds);
        await fixSegment(part);
        const timing = fragmentTiming(await head(part));
        const bytes = (await fsp.stat(part)).size;
        await fsp.rename(part, path.join(folder, segmentName(index, timing.t)));
        entries.set(timing.t, { n: timing.t, ...timing, bytes });
        // Past the end the server only repeats the end: stop once nothing new arrives there.
        idle = at().covered > covered || n * seconds < mpd.duration ? 0 : idle + 1;
        if (idle >= 3) break;
        tally();
        n++;
      }
      const { kept, holes } = at();
      if (holes.length) throw failure('Part of this video is missing. Resume to try again.', 502);
      // Drop what only repeated other segments, so the folder holds just the playable timeline.
      const keep = new Set(kept.map((e) => e.n));
      for (const e of entries.values()) if (!keep.has(e.n)) await fsp.rm(path.join(folder, segmentName(index, e.n)), { force: true });
      return { timescale, entries: kept.map(({ n, t, d }) => ({ n, t, d })) };
    };
    const timelines = await Promise.all(mpd.sets.map(stream));
    const sets = mpd.sets.map((set, i) => ({ mimeType: set.mimeType, codecs: set.codecs, bandwidth: set.bandwidth, width: set.width, height: set.height, sampleRate: set.sampleRate, timeline: timelines[i] }));
    item.files.segments = { signature, sets, duration: mpd.duration, timed: 2 };
    await this.recount(item);
    item.total = item.received;
    this.save();
    return localManifest({ duration: mpd.duration, sets }, conversion.audio.locale);
  }
  async asset(item, resource, filename, signal, maxBytes, validate) {
    const started = Date.now();
    let res;
    // Some sources prepare a file first (Plex subtitles): 202 until it's ready.
    while ((res = await this.request(item.server, resource, { signal })).status === 202) {
      await res.body?.cancel();
      if (Date.now() - started > 120000) throw new Error(`${filename} took too long to prepare. Resume to retry.`);
      await wait(1000, undefined, { signal });
    }
    if (!res.ok || !res.body) { await res.body?.cancel(); throw failure(`Could not download ${filename}.`, res.status); }
    const chunks = []; let length = 0;
    for await (const chunk of res.body) { length += chunk.byteLength; if (length > maxBytes) throw new Error(`${filename} is too large.`); chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    if (validate && !validate(body)) throw new Error(`${filename} has an invalid format.`);
    if (this.free() < body.length + 32 * 1024 ** 2) throw new Error('Download storage is full.');
    await fsp.writeFile(path.join(this.folder(item), filename), body);
  }
  async run(item, signal) {
    item.status = 'downloading'; item.error = item.warning = item.retryAt = undefined; this.save();
    const ctx = { server: item.server }, backend = backendOf(item);
    const plan = await this.plan({ backend, videoId: item.videoId }, signal, ctx);
    let tracks;
    if (item.selection.conversion !== undefined) {
      const conversion = plan.conversions?.find((c) => c.id === item.selection.conversion);
      if (!conversion) throw new Error('This audio and quality are no longer available. Remove this download and choose again.');
      tracks = async () => {
        try { return await this.segments(item, conversion, signal); }
        // End the server's session either way; a resumed download starts a new one.
        finally { if (conversion.release) await this.request(item.server, conversion.release, { method: 'POST', signal: AbortSignal.timeout(5000) }).then((r) => r.body?.cancel()).catch(() => {}); }
      };
    } else if (item.selection.file !== undefined) {
      const file = plan.files?.find((f) => f.id === item.selection.file);
      if (!file) throw new Error('This file is no longer available. Remove this download and choose it again.');
      item.total = file.bytes;
      tracks = () => this.file(item, file, signal);
    } else {
      const video = plan.tracks.find((t) => t.id === item.selection.videoTrack && t.kind === 'video');
      const audio = plan.tracks.find((t) => t.id === item.selection.audioTrack && t.kind === 'audio');
      if (!video || !audio) throw new Error('The selected tracks are unavailable. Remove this download and choose another quality.');
      item.total = Math.ceil((video.bytes || video.bandwidth * plan.duration / 8) + (audio.bytes || audio.bandwidth * plan.duration / 8));
      tracks = async () => {
        await this.track(item, video, 'video', signal);
        await this.track(item, audio, 'audio', signal);
        return manifest(plan.duration, video, audio);
      };
    }
    await this.recount(item);
    const mpd = await tracks();
    // Requested subtitles are required: don't label the download ready if they failed.
    item.subtitles = [];
    for (const [index, url] of item.selection.subtitles.entries()) {
      // Subtitle URLs expire too; match against the metadata retained at selection time.
      const old = item.captionSelections?.[index];
      const subtitle = old ? plan.subtitles.find((s) => s.locale === old.locale && s.label === old.label && (backend === 'youtube' || (s.id ?? '') === (old.id ?? ''))) : plan.subtitles.find((s) => s.url === url);
      if (!subtitle || !subtitleTypes[subtitle.format] || subtitle.render === 'server') throw new Error('A selected subtitle track is unavailable. Remove this download and retry.');
      const filename = `subtitle-${index}.${subtitle.format}`;
      await this.asset(item, subtitle.url, filename, signal, 20 * 1024 ** 2, subtitle.format === 'vtt' ? (b) => /^\uFEFF?WEBVTT(?:\s|$)/.test(b.toString('utf8')) : (b) => b.toString('utf8').includes('[Events]'));
      item.subtitles.push({ ...subtitle, url: filename });
    }
    try {
      await this.asset(item, item.video.thumbnail, 'thumbnail', signal, 10 * 1024 ** 2);
      item.hasThumbnail = true;
    } catch (error) { signal.throwIfAborted(); item.warning = 'Thumbnail unavailable; the downloaded video is ready.'; }
    if (item.channel.avatar) {
      try { await this.asset(item, item.channel.avatar, 'channel-avatar', signal, 5 * 1024 ** 2); item.hasAvatar = true; }
      catch { signal.throwIfAborted(); }
    }
    signal.throwIfAborted();
    if (mpd) await fsp.writeFile(path.join(this.folder(item), 'manifest.mpd'), mpd);
    await this.recount(item);
    item.status = 'complete'; item.downloadedAt = Date.now(); item.total = item.received; item.retries = 0;
    this.save();
    this.completed(this.view(item));
  }
  detail(id) {
    const item = this.item(id);
    if (item.status !== 'complete') throw new Error('This download is not ready yet.');
    const base = `fanoos-offline://app/media/${item.id}/`;
    return { video: { ...item.video, thumbnail: item.hasThumbnail ? `${base}thumbnail` : '', channelAvatar: item.hasAvatar ? `${base}channel-avatar` : '' }, channel: { ...item.channel, avatar: item.hasAvatar ? `${base}channel-avatar` : '' }, downloadedAt: item.downloadedAt || item.createdAt, quality: item.quality, next: [], stream: { ...(item.files.media ? { progressive: `${base}media.track` } : { dash: `${base}manifest.mpd` }), subtitles: (item.subtitles || []).map((s) => ({ ...s, url: base + s.url })) } };
  }
  async media(id, filename, request) {
    const item = this.item(id);
    if (item.status !== 'complete') return new Response(null, { status: 404 });
    const types = { 'manifest.mpd': item.files.media ? undefined : 'application/dash+xml', 'video.track': item.files.video?.type, 'audio.track': item.files.audio?.type, 'media.track': item.files.media?.type, thumbnail: 'image/jpeg', 'channel-avatar': 'image/jpeg' };
    for (const s of item.subtitles || []) types[s.url] = subtitleTypes[s.format] ?? subtitleTypes.vtt;
    const segment = /^s(\d+)-(?:init\.mp4|\d+\.m4s)$/.exec(filename);
    if (segment && fs.existsSync(path.join(this.folder(item), filename))) types[filename] = item.files.segments?.sets[Number(segment[1])]?.mimeType;
    if (!types[filename]) return new Response(null, { status: 404 });
    const origin = request.headers.get('origin');
    if (origin && !['fanoos-offline://app', this.context.server].includes(origin)) return new Response(null, { status: 403 });
    if (filename === 'manifest.mpd' && item.files.segments && item.files.segments.timed !== 2) await this.repair(item).catch(() => {});
    return serveFile(path.join(this.folder(item), filename), types[filename], request, { 'access-control-allow-origin': origin || 'fanoos-offline://app', 'access-control-expose-headers': 'content-range, content-length, accept-ranges' });
  }
  /**
   * Downloads saved before segments were timed assumed fixed-length segments, but a copied video's
   * vary, and the server sent some twice. Reads each saved segment's real timing, fixes keyframe
   * times Chromium can't play (see fixKeyframeTime) and rewrites the manifest to list the
   * playable segments in order; nothing is deleted.
   */
  repair(item) {
    this.repairs ??= new Map();
    if (!this.repairs.has(item.id)) this.repairs.set(item.id, (async () => {
      const folder = this.folder(item), file = path.join(folder, 'manifest.mpd');
      const text = await fsp.readFile(file, 'utf8');
      const mpd = segmentedManifest(text), language = /<AdaptationSet[^>]*\blang="([^"]+)"/.exec(text)?.[1];
      const names = await fsp.readdir(folder);
      let missing = 0;
      const sets = await Promise.all(mpd.sets.map(async (set, index) => {
        const timescale = trackTimescale(await fsp.readFile(path.join(folder, segmentName(index, 'init'))));
        const entries = [];
        for (const name of names) {
          const m = new RegExp(`^s${index}-(\\d+)\\.m4s$`).exec(name);
          if (!m) continue;
          await fixSegment(path.join(folder, name));
          entries.push({ n: Number(m[1]), ...fragmentTiming(await head(path.join(folder, name))) });
        }
        const { kept, holes } = playable(entries, 0.05 * timescale);
        missing = Math.max(missing, holes.reduce((sum, [a, b]) => sum + (b - a) / timescale, 0));
        return { mimeType: set.mimeType, codecs: set.codecs, bandwidth: set.bandwidth, width: set.width, height: set.height, sampleRate: set.sampleRate, timeline: { timescale, entries: kept.map(({ n, t, d }) => ({ n, t, d })) } };
      }));
      await fsp.writeFile(`${file}.part`, localManifest({ duration: mpd.duration, sets }, language));
      await fsp.rename(`${file}.part`, file);
      item.files.segments = { ...item.files.segments, sets, duration: mpd.duration, timed: 2, ...(missing > 0.5 ? { missing: Math.round(missing) } : {}) };
      this.save();
    })().finally(() => this.repairs.delete(item.id)));
    return this.repairs.get(item.id);
  }
  readState() { return this.data.states[this.requireContext().scope] ?? { data: null, dirty: false }; }
  writeState(value, offline) {
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 600000) throw new Error('Invalid offline state.');
    const scope = this.requireContext().scope;
    const previous = this.data.states[scope];
    const progress = { ...(previous?.pendingProgress || {}) };
    const history = { ...(previous?.pendingHistory || {}) };
    if (offline) {
      for (const [key, position] of Object.entries(value.progress || {})) if (previous?.data?.progress?.[key] !== position) progress[key] = position;
      for (const key of Object.keys(previous?.data?.progress || {})) if (!(key in (value.progress || {}))) progress[key] = null;
      for (const entry of value.history || []) if (!previous?.data?.history?.some((old) => old.id === entry.id && old.at === entry.at)) history[entry.id] = entry;
    }
    this.data.states[scope] = { data: value, dirty: offline, pendingProgress: offline ? progress : {}, pendingHistory: offline ? history : {} };
    this.save();
  }
  shutdown() {
    clearTimeout(this.retryTimer);
    for (const item of this.data.items) if (['queued', 'downloading'].includes(item.status)) { item.status = 'paused'; item.resumeOnConnect = true; item.retryAt = undefined; }
    this.active?.controller.abort();
    this.save();
  }
}
module.exports = { Downloads, manifest, serveFile, fingerprint, scopeOf, captionKey, segmentedManifest, localManifest };
