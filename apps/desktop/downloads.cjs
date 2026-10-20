const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');

const GiB = 1024 ** 3;
const scopeOf = (server, profileId) => createHash('sha256').update(`${server}\n${profileId}`).digest('hex');
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const fingerprint = (t) => JSON.stringify([t.id, t.mimeType, t.codecs, t.bytes, t.revision, t.initRange, t.indexRange, t.width, t.height, t.fps]);
const safeVideoId = (value) => typeof value === 'string' && /^[\w-]{11}$/.test(value);

function manifest(duration, video, audio) {
  const set = (t, name) => `<AdaptationSet contentType="${t.kind}" mimeType="${xml(t.mimeType)}"${t.language ? ` lang="${xml(t.language)}"` : ''}><Label>${xml(t.label)}</Label><Representation id="${xml(t.id)}" bandwidth="${t.bandwidth}" codecs="${xml(t.codecs)}"${t.width ? ` width="${t.width}" height="${t.height}" frameRate="${t.fps || 30}"` : ''}${t.sampleRate ? ` audioSamplingRate="${t.sampleRate}"` : ''}>${t.channels ? `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${t.channels}"/>` : ''}<BaseURL>${name}.track</BaseURL><SegmentBase indexRange="${xml(t.indexRange)}"><Initialization range="${xml(t.initRange)}"/></SegmentBase></Representation></AdaptationSet>`;
  return `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT${duration}S" minBufferTime="PT1.5S"><Period>${set(video, 'video')}${set(audio, 'audio')}</Period></MPD>`;
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
  constructor({ directory, fetch: fetcher, notify = () => {} }) {
    this.directory = directory;
    this.root = path.join(directory, 'offline-media');
    this.journal = path.join(directory, 'downloads.json');
    this.fetch = fetcher;
    this.notify = notify;
    fs.mkdirSync(this.root, { recursive: true });
    try { this.data = JSON.parse(fs.readFileSync(this.journal, 'utf8')); } catch { this.data = { items: [], states: {}, limitBytes: 20 * GiB, context: null }; }
    this.context = this.data.context;
    for (const item of this.data.items) if (['queued', 'downloading'].includes(item.status)) { item.status = 'paused'; item.error = 'Paused after restart. Resume when connected.'; }
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
    if (this.context?.scope !== next.scope && this.active) this.active.controller.abort();
    this.context = this.data.context = next;
    this.save();
    this.pump();
  }
  async lock(remove = false) {
    const scope = this.context?.scope;
    for (const item of this.data.items) if (item.scope === scope && item.status === 'queued') item.status = 'paused';
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
    const { id, videoId, video, channel, status, quality, audio, received, total, createdAt, downloadedAt, error, warning } = item;
    return { id, videoId, video: { ...video, thumbnail: item.hasThumbnail ? `fanoos-offline://app/media/${id}/thumbnail` : video.thumbnail }, channel, status, quality, audio, received, total, createdAt, downloadedAt, error, warning };
  }
  list() {
    return { items: this.data.items.filter((i) => i.scope === this.context?.scope).map((i) => this.view(i)), usedBytes: this.used(), freeBytes: this.free(), limitBytes: this.data.limitBytes, profileName: this.context?.profileName ?? '', server: this.context?.server ?? '' };
  }
  setLimit(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < GiB || bytes > 500 * GiB) throw new Error('Choose a storage limit between 1 and 500 GB.');
    this.data.limitBytes = bytes; this.save();
  }
  async request(server, resource, init = {}) {
    const url = new URL(resource, server);
    if (url.origin !== server || !url.pathname.startsWith('/api/')) throw new Error('Download source must be on your Fanoos server.');
    return this.fetch(url.href, { ...init, credentials: 'include', redirect: 'error' });
  }
  async json(server, resource, signal) {
    const res = await this.request(server, resource, { signal: signal ?? AbortSignal.timeout(90000) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Server returned ${res.status}. Reconnect and try again.`); }
    return res.json();
  }
  async plan(videoId, signal, context = this.requireContext()) {
    if (!safeVideoId(videoId)) throw new Error('Invalid YouTube video.');
    return this.json(context.server, `/api/v/youtube/videos/${videoId}/download`, signal);
  }
  async add(selection) {
    if (!selection || !safeVideoId(selection.videoId) || typeof selection.videoTrack !== 'string' || typeof selection.audioTrack !== 'string' || !Array.isArray(selection.subtitles) || selection.subtitles.length > 20 || selection.subtitles.some((s) => typeof s !== 'string')) throw new Error('Invalid download selection.');
    const ctx = this.requireContext();
    const existing = this.data.items.find((i) => i.scope === ctx.scope && i.videoId === selection.videoId);
    if (existing) throw new Error('This video is already in Downloads. Remove it before choosing another quality.');
    const [plan, detail] = await Promise.all([this.plan(selection.videoId), this.json(ctx.server, `/api/v/youtube/videos/${selection.videoId}`)]);
    if (this.context?.scope !== ctx.scope) throw new Error('Your active profile changed. Try again.');
    if (detail.stream?.drm || detail.video.live || detail.video.upcoming) throw new Error('Only unencrypted on-demand YouTube videos can be downloaded.');
    const video = plan.tracks.find((t) => t.id === selection.videoTrack && t.kind === 'video');
    const audio = plan.tracks.find((t) => t.id === selection.audioTrack && t.kind === 'audio');
    if (!video || !audio) throw new Error('These tracks are no longer available. Choose your download quality again.');
    const estimate = (video.bytes || video.bandwidth * plan.duration / 8) + (audio.bytes || audio.bandwidth * plan.duration / 8);
    if (this.used() + estimate > this.data.limitBytes) throw new Error('Your download storage limit would be exceeded. Remove a download or raise the limit.');
    if (estimate + 64 * 1024 ** 2 > this.free()) throw new Error('There is not enough free disk space for this download.');
    const item = {
      id: randomBytes(16).toString('hex'), scope: ctx.scope, server: ctx.server, profileId: ctx.profileId,
      videoId: selection.videoId, selection, video: detail.video, channel: detail.channel,
      captionSelections: selection.subtitles.map((key) => plan.subtitles.find((s) => `${s.locale}\n${s.label}` === key)),
      status: 'queued', quality: video.label, audio: audio.label, received: 0, total: Math.ceil(estimate), createdAt: Date.now(), files: {},
    };
    if (item.captionSelections.some((s) => !s || s.format !== 'vtt')) throw new Error('Selected captions are no longer available.');
    // The async metadata requests above may overlap another add.
    if (this.data.items.some((i) => i.scope === ctx.scope && i.videoId === item.videoId)) throw new Error('This video is already in Downloads.');
    fs.mkdirSync(this.folder(item));
    this.data.items.unshift(item); this.save(); this.pump();
    return this.view(item);
  }
  pump() {
    if (this.active || !this.context) return;
    const item = this.data.items.find((i) => i.scope === this.context.scope && i.status === 'queued');
    if (!item) return;
    const controller = new AbortController();
    this.active = { id: item.id, controller, done: null };
    this.active.done = this.run(item, controller.signal).catch((error) => {
      item.status = controller.signal.aborted ? 'paused' : 'failed';
      item.error = controller.signal.aborted ? undefined : error.message;
      this.save();
    }).finally(() => { this.active = null; this.pump(); });
  }
  async pause(id) {
    const item = this.item(id);
    item.status = 'paused';
    if (this.active?.id === id) { const active = this.active; active.controller.abort(); await active.done; }
    this.save();
  }
  resume(id) { const item = this.item(id); if (item.status === 'complete' || this.active?.id === id) return; item.status = 'queued'; item.error = undefined; this.save(); this.pump(); }
  async remove(id) { const item = this.item(id); await this.pause(id); await fsp.rm(this.folder(item), { recursive: true, force: true }); this.data.items = this.data.items.filter((i) => i.id !== id); this.save(); }
  async recount(item) {
    const files = await fsp.readdir(this.folder(item));
    item.received = (await Promise.all(files.filter((f) => !f.endsWith('.mpd')).map(async (f) => (await fsp.stat(path.join(this.folder(item), f))).size))).reduce((a, b) => a + b, 0);
  }
  async track(item, track, name, signal) {
    if (!track || !Number.isFinite(track.bandwidth) || track.bandwidth <= 0 || !/^(video|audio)\/(mp4|webm)$/.test(track.mimeType) || !/^[0-9]+-[0-9]+$/.test(track.initRange) || !/^[0-9]+-[0-9]+$/.test(track.indexRange)) throw new Error('The server returned an unsupported media track.');
    const source = new URL(track.url, item.server);
    if (!source.pathname.startsWith('/api/b/youtube/public/media')) throw new Error('Invalid media source.');
    const dest = path.join(this.folder(item), `${name}.track`), partial = `${dest}.part`;
    const signature = fingerprint(track);
    if (item.files[name]?.signature !== signature || !track.bytes) {
      await fsp.rm(dest, { force: true }); await fsp.rm(partial, { force: true });
      item.files[name] = { signature, type: track.mimeType };
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
    if (!res.ok || !res.body) throw new Error(`Media transfer failed (${res.status}). Resume to obtain fresh stream URLs.`);
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') || '');
    if (res.status === 206 && (!range || Number(range[1]) !== offset || (track.bytes && Number(range[3]) !== track.bytes))) { await res.body.cancel(); throw new Error('The server returned an unexpected byte range. Retry the download.'); }
    const expected = range ? Number(range[3]) : Number(res.headers.get('content-length')) + offset;
    if (track.bytes && expected && expected !== track.bytes) { await res.body.cancel(); throw new Error('This media track changed. Remove the download and select it again.'); }
    const file = await fsp.open(partial, 'a');
    let last = 0;
    try {
      for await (const chunk of res.body) {
        signal.throwIfAborted();
        if (this.used() + chunk.byteLength > this.data.limitBytes || this.free() < chunk.byteLength + 32 * 1024 ** 2) throw new Error('Download storage is full. Free some space, then resume.');
        let written = 0;
        while (written < chunk.byteLength) { const result = await file.write(chunk, written, chunk.byteLength - written); written += result.bytesWritten; }
        offset += chunk.byteLength; item.received += chunk.byteLength;
        if (Date.now() - last > 500) { this.save(); last = Date.now(); }
      }
    } finally { await file.close(); }
    if (!offset || (track.bytes && offset !== track.bytes) || (expected && offset !== expected)) throw new Error('The transfer ended before the media file was complete. Resume to retry.');
    await fsp.rename(partial, dest);
    this.save();
  }
  async asset(item, resource, filename, signal, maxBytes, validate) {
    const res = await this.request(item.server, resource, { signal });
    if (!res.ok || !res.body) throw new Error(`Could not download ${filename}.`);
    const chunks = []; let length = 0;
    for await (const chunk of res.body) { length += chunk.byteLength; if (length > maxBytes) throw new Error(`${filename} is too large.`); chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    if (validate && !validate(body)) throw new Error(`${filename} has an invalid format.`);
    if (this.used() + body.length > this.data.limitBytes || this.free() < body.length + 32 * 1024 ** 2) throw new Error('Download storage is full.');
    await fsp.writeFile(path.join(this.folder(item), filename), body);
  }
  async run(item, signal) {
    item.status = 'downloading'; item.error = item.warning = undefined; this.save();
    const ctx = { server: item.server };
    const plan = await this.plan(item.videoId, signal, ctx);
    const video = plan.tracks.find((t) => t.id === item.selection.videoTrack && t.kind === 'video');
    const audio = plan.tracks.find((t) => t.id === item.selection.audioTrack && t.kind === 'audio');
    if (!video || !audio) throw new Error('The selected tracks are unavailable. Remove this download and choose another quality.');
    item.total = Math.ceil((video.bytes || video.bandwidth * plan.duration / 8) + (audio.bytes || audio.bandwidth * plan.duration / 8));
    await this.recount(item);
    await this.track(item, video, 'video', signal);
    await this.track(item, audio, 'audio', signal);
    // Requested captions are required: don't label the download ready if they failed.
    item.subtitles = [];
    for (const [index, url] of item.selection.subtitles.entries()) {
      // Caption URLs expire too; match against the metadata retained at selection time.
      const old = item.captionSelections?.[index];
      const subtitle = old ? plan.subtitles.find((s) => s.locale === old.locale && s.label === old.label) : plan.subtitles.find((s) => s.url === url);
      if (!subtitle || subtitle.format !== 'vtt') throw new Error('A selected caption track is unavailable. Remove this download and retry.');
      const filename = `subtitle-${index}.vtt`;
      await this.asset(item, subtitle.url, filename, signal, 20 * 1024 ** 2, (b) => /^\uFEFF?WEBVTT(?:\s|$)/.test(b.toString('utf8')));
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
    await fsp.writeFile(path.join(this.folder(item), 'manifest.mpd'), manifest(plan.duration, video, audio));
    await this.recount(item);
    item.status = 'complete'; item.downloadedAt = Date.now(); item.total = item.received;
    this.save();
  }
  detail(id) {
    const item = this.item(id);
    if (item.status !== 'complete') throw new Error('This download is not ready yet.');
    const base = `fanoos-offline://app/media/${item.id}/`;
    return { video: { ...item.video, thumbnail: item.hasThumbnail ? `${base}thumbnail` : '', channelAvatar: item.hasAvatar ? `${base}channel-avatar` : '' }, channel: { ...item.channel, avatar: item.hasAvatar ? `${base}channel-avatar` : '' }, downloadedAt: item.downloadedAt || item.createdAt, quality: item.quality, next: [], stream: { dash: `${base}manifest.mpd`, subtitles: (item.subtitles || []).map((s) => ({ ...s, url: base + s.url })) } };
  }
  async media(id, filename, request) {
    const item = this.item(id);
    if (item.status !== 'complete') return new Response(null, { status: 404 });
    const types = { 'manifest.mpd': 'application/dash+xml', 'video.track': item.files.video?.type, 'audio.track': item.files.audio?.type, thumbnail: 'image/jpeg', 'channel-avatar': 'image/jpeg' };
    for (const s of item.subtitles || []) types[s.url] = 'text/vtt';
    if (!types[filename]) return new Response(null, { status: 404 });
    const origin = request.headers.get('origin');
    if (origin && !['fanoos-offline://app', this.context.server].includes(origin)) return new Response(null, { status: 403 });
    return serveFile(path.join(this.folder(item), filename), types[filename], request, { 'access-control-allow-origin': origin || 'fanoos-offline://app', 'access-control-expose-headers': 'content-range, content-length, accept-ranges' });
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
  shutdown() { if (this.active) { this.data.items.find((i) => i.id === this.active.id).status = 'paused'; this.active.controller.abort(); } this.save(); }
}
module.exports = { Downloads, manifest, serveFile, fingerprint, scopeOf };
