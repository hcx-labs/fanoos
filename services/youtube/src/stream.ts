/*
 * Playback through Invidious companion (vendor/invidious-companion).
 *
 * The anonymous instance (`npm run companion`) streams every video signed out and
 * keeps YouTube's anti-bot (PO) tokens fresh. An optional signed-in instance
 * (`npm run companion:signed-in`) is asked only when YouTube age-restricts a video,
 * so ordinary viewing is never tied to a Google account.
 *
 * Both listen on 127.0.0.1. This backend asks them for playability and DASH
 * manifests and rewrites every segment URL to its signed /public/media proxy, so
 * browsers only ever talk to Fanoos.
 */
import type { DownloadPlan, DownloadTrack } from "@tube/shared";
import { SharedCache } from "./cache.ts";
import { config } from "./config.ts";
import { type CompanionInstance, proxyCompanion, proxyCaption } from "./media.ts";
import { captionSubtitles, type CaptionTrack } from "./captions.ts";
import { audioMetadata, xmlEscape } from "./audio-metadata.ts";
import { getSettings } from "./settings.ts";
import { signedInReady, signedInUrl } from "./signed-in.ts";

export type Playability =
  | { ok: true; instance: CompanionInstance }
  | { ok: false; code: "age_restricted" | "unplayable" | "starting" | "bot_check"; reason: string };

const { companion } = config;
const baseOf = (instance: CompanionInstance) => (instance === "s" ? signedInUrl : companion.url);
const NOT_RUNNING = "The streaming service isn't running on this server. Start it with `npm run companion`.";

type Status = { status?: string; reason?: string };

async function playerStatus(instance: CompanionInstance, id: string): Promise<Status | null> {
  const res = await fetch(`${baseOf(instance)}/companion/youtubei/v1/player`, {
    method: "POST",
    headers: { authorization: `Bearer ${companion.secret}`, "content-type": "application/json" },
    body: JSON.stringify({ videoId: id }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const player = await res.json() as PlayerResponse;
  // Reuse this response for captions and the manifest instead of asking the companion twice.
  if (player.playabilityStatus?.status === "OK") {
    await playerCache.setMany([[`${instance}:${id}`, player]]).catch(() => {});
  }
  return player.playabilityStatus ?? null;
}

const isAgeGate = (s: Status) => s.status === "LOGIN_REQUIRED" && /age|inappropriate/i.test(s.reason ?? "");
/** "Sign in to confirm you're not a bot": YouTube distrusts this server's address. */
const isBotCheck = (s: Status) => /not a bot|confirm you/i.test(s.reason ?? "");

/**
 * Only settled answers are cached: the anonymous instance streams it, or it can't be played.
 * The rest (age gate, bot check, warming up, the signed-in fallback) can change within a
 * minute, e.g. right after age-restricted playback is set up, so they're asked again each time.
 */
const playabilityCache = new SharedCache<Playability>("playability", {
  staleSeconds: 3600,
  keep: (p) => (p.ok ? p.instance === "a" : p.code === "unplayable"),
});

/** Whether the video can be streamed (and by which instance), or why not. */
export function playability(id: string): Promise<Playability> {
  if (!companion.configured) return Promise.resolve({ ok: false, code: "unplayable", reason: NOT_RUNNING });
  return playabilityCache.get(id, async () => {
    const anon = await playerStatus("a", id);
    if (!anon) return { ok: false, code: "unplayable", reason: NOT_RUNNING };
    if (anon.status === "OK") return { ok: true, instance: "a" };
    if (isAgeGate(anon)) {
      const signed = signedInReady() ? await playerStatus("s", id) : null;
      if (signed?.status === "OK") return { ok: true, instance: "s" };
      return { ok: false, code: "age_restricted", reason: anon.reason ?? "Age-restricted." };
    }
    // No anti-bot token yet (warming up, or YouTube keeps refusing this address) and the bot check
    // itself have the same cause; with the owner's fallback on, the signed-in instance takes over.
    const noToken = /token|not ready|starting/i.test(anon.reason ?? "");
    if ((isBotCheck(anon) || noToken) && getSettings().botCheckFallback && signedInReady()) {
      const signed = await playerStatus("s", id);
      if (signed?.status === "OK") {
        return { ok: true, instance: "s" };
      }
    }
    if (isBotCheck(anon)) {
      return { ok: false, code: "bot_check", reason: "YouTube asked this server to sign in to confirm it isn't a bot." };
    }
    // Reported while the companion generates its first anti-bot token (after a restart). It
    // passes on its own, so say so plainly and let the app retry.
    if (noToken) {
      return { ok: false, code: "starting", reason: "The streaming service is starting up. This usually takes under a minute." };
    }
    return { ok: false, code: "unplayable", reason: anon.reason ?? "This video can't be played." };
  });
}

type Range = { start: string; end: string };
type Format = {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate: number;
  contentLength?: string;
  width?: number;
  height?: number;
  fps?: number;
  initRange?: Range;
  indexRange?: Range;
  approxDurationMs?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  audioTrack?: { id: string; displayName: string; audioIsDefault: boolean };
};

type PlayerResponse = {
  playabilityStatus?: Status;
  streamingData?: { adaptiveFormats?: Format[] };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
};
// Stream URLs expire after ~6 hours, so stale copies are only served for an hour.
const playerCache = new SharedCache<PlayerResponse>("player-captions-v2", { staleSeconds: 3600 });
const manifests = new SharedCache<string>("manifest-audio-v2", { staleSeconds: 3600 });

/** The companion's player response: deciphered stream URLs carrying the PO token. */
function playerResponse(instance: CompanionInstance, id: string) {
  return playerCache.get(`${instance}:${id}`, async () => {
    const res = await fetch(`${baseOf(instance)}/companion/youtubei/v1/player`, {
      method: "POST",
      headers: { authorization: `Bearer ${companion.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ videoId: id }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`companion player ${res.status}`);
    return (await res.json()) as PlayerResponse;
  });
}

/** Caption metadata is optional: its failure must never make a playable video unavailable. */
export async function subtitles(id: string, instance: CompanionInstance) {
  try {
    const player = await playerResponse(instance, id);
    return captionSubtitles(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
      (label) => proxyCaption(id, label, instance));
  } catch { return []; }
}
/**
 * YouTube labels VP9 as just "vp9" (or "vp9.2" for HDR). Browsers' capability checks
 * need the full form (profile.level.bitDepth), or players drop the track, losing 1440p/4K.
 */
function fullCodec(codecs: string, height = 0) {
  if (codecs !== "vp9" && codecs !== "vp9.2") return codecs;
  const level = height > 1440 ? "51" : height > 1080 ? "50" : height > 720 ? "41" : "40";
  return codecs === "vp9.2" ? `vp09.02.${level}.10` : `vp09.00.${level}.08`;
}

const codecFamily = (codecs: string) => (/^av01/.test(codecs) ? "av1" : /^vp0?9/.test(codecs) ? "vp9" : /^avc1/.test(codecs) ? "h264" : codecs.split(".")[0]!);

/**
 * Builds the DASH manifest ourselves from every adaptive format, one adaptation set
 * per container and codec (H.264, VP9, AV1; AAC, Opus), so the player can pick the
 * codec the device decodes best. YouTube's 1440p and 4K are VP9/AV1 only.
 */
export function dashManifest(id: string, base: string): Promise<string> {
  return manifests.get(`${base}|${id}`, async () => {
    const play = await playability(id);
    if (!play.ok) throw new Error(play.reason);
    const formats = ((await playerResponse(play.instance, id)).streamingData?.adaptiveFormats ?? []).filter(
      (f) => f.url && f.initRange && f.indexRange,
    );
    if (!formats.length) throw new Error("No streamable formats.");
    const duration = Math.max(...formats.map((f) => Number(f.approxDurationMs ?? 0))) / 1000;

    const sets = new Map<string, Format[]>();
    for (const f of formats) {
      const [mime] = f.mimeType.split(";");
      const codecs = /codecs="([^"]+)"/.exec(f.mimeType)?.[1] ?? "";
      const key = `${mime}|${codecFamily(codecs)}|${f.audioTrack?.id ?? ""}`;
      sets.set(key, [...(sets.get(key) ?? []), f]);
    }

    const url = (f: Format) => {
      const u = new URL(f.url!);
      return proxyCompanion(`/companion/videoplayback?${u.searchParams}&host=${u.host}`, base, play.instance);
    };
    let setId = 0;
    const adaptationSets = [...sets.entries()].map(([key, list]) => {
      const [mime, family] = key.split("|") as [string, string];
      const video = mime.startsWith("video/");
      const track = list[0]!.audioTrack;
      const audio = audioMetadata(track);
      const lang = video ? undefined : audio.lang;
      const label = video ? family : audio.label;
      const reps = list
        .sort((a, b) => b.bitrate - a.bitrate)
        .map((f) => {
          const codecs = fullCodec(/codecs="([^"]+)"/.exec(f.mimeType)?.[1] ?? "", f.height);
          const attrs = video
            ? `width="${f.width}" height="${f.height}" frameRate="${f.fps ?? 30}"`
            : `audioSamplingRate="${f.audioSampleRate ?? 48000}"`;
          return [
            `      <Representation id="${f.itag}${track ? `-${xmlEscape(track.id)}` : ""}" codecs="${xmlEscape(codecs)}" bandwidth="${f.bitrate}" ${attrs}>`,
            video ? "" : `        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${f.audioChannels ?? 2}"/>`,
            `        <BaseURL>${xmlEscape(url(f))}</BaseURL>`,
            `        <SegmentBase indexRange="${f.indexRange!.start}-${f.indexRange!.end}"><Initialization range="${f.initRange!.start}-${f.initRange!.end}"/></SegmentBase>`,
            "      </Representation>",
          ]
            .filter(Boolean)
            .join("\n");
        });
      return [
        `    <AdaptationSet id="${setId++}" mimeType="${mime}" contentType="${video ? "video" : "audio"}" subsegmentAlignment="true" subsegmentStartsWithSAP="1"${lang ? ` lang="${xmlEscape(lang)}"` : ""} label="${xmlEscape(label)}">`,
        video ? "" : `      <Label>${xmlEscape(label)}</Label>`,
        video ? "" : `      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="${audio.role}"/>`,
        ...reps,
        "    </AdaptationSet>",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT${duration.toFixed(3)}S" minBufferTime="PT1.5S">`,
      "  <Period>",
      ...adaptationSets,
      "  </Period>",
      "</MPD>",
      "",
    ].join("\n");
  });
}

/** Resolve a fresh set of tracks for a desktop download or resumed attempt. */
export async function downloadPlan(id: string, base: string): Promise<DownloadPlan> {
  const play = await playability(id);
  if (!play.ok) throw new Error(play.reason);
  // Playback caches may hold expiring URLs; download retries must obtain new ones.
  await playerCache.delete(`${play.instance}:${id}`);
  const response = await playerResponse(play.instance, id);
  const formats = (response.streamingData?.adaptiveFormats ?? []).filter((f) => f.url && f.initRange && f.indexRange && Number(f.approxDurationMs) > 0);
  const tracks: DownloadTrack[] = formats.flatMap((f) => {
    const mimeType = f.mimeType.split(";")[0]!;
    if (!/^(video|audio)\/(mp4|webm)$/.test(mimeType)) return [];
    const audio = audioMetadata(f.audioTrack);
    const upstream = new URL(f.url!);
    const bytes = Number(f.contentLength);
    return [{
      id: `${f.itag}${f.audioTrack ? `-${f.audioTrack.id}` : ""}`,
      kind: mimeType.startsWith("video/") ? "video" : "audio",
      mimeType, codecs: fullCodec(/codecs="([^"]+)"/.exec(f.mimeType)?.[1] ?? "", f.height),
      bandwidth: f.bitrate, bytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined,
      revision: upstream.searchParams.get("lmt") ?? undefined,
      width: f.width, height: f.height, fps: f.fps,
      language: audio.lang, label: mimeType.startsWith("video/") ? `${f.height}p · ${codecFamily(/codecs="([^"]+)"/.exec(f.mimeType)?.[1] ?? "")}${f.fps && f.fps > 30 ? ` · ${f.fps}fps` : ""}` : audio.label,
      default: !f.audioTrack || f.audioTrack.audioIsDefault,
      sampleRate: Number(f.audioSampleRate) || undefined, channels: f.audioChannels,
      initRange: `${f.initRange!.start}-${f.initRange!.end}`, indexRange: `${f.indexRange!.start}-${f.indexRange!.end}`,
      url: proxyCompanion(`/companion/videoplayback?${upstream.searchParams}&host=${upstream.host}`, base, play.instance),
    } satisfies DownloadTrack];
  });
  if (!tracks.some((t) => t.kind === "video") || !tracks.some((t) => t.kind === "audio")) throw new Error("No downloadable on-demand tracks available.");
  return { duration: Math.max(...formats.map((f) => Number(f.approxDurationMs))) / 1000, tracks, subtitles: await subtitles(id, play.instance) };
}
