/*
 * Playback through Invidious companion (vendor/invidious-companion).
 *
 * The anonymous instance (`npm run companion`) streams every video signed out and
 * keeps YouTube's anti-bot (PO) tokens fresh. An optional signed-in instance
 * (`npm run companion:signed-in`) is asked only when YouTube age-restricts a video,
 * so ordinary viewing is never tied to a Google account.
 *
 * Both listen on 127.0.0.1. This server asks them for playability and DASH
 * manifests and rewrites every segment URL to the signed /api/media proxy, so
 * browsers only ever talk to this server.
 */
import { TtlCache } from "../cache.ts";
import { config } from "../config.ts";
import { type CompanionInstance, proxyCompanion } from "../media.ts";
import { signedInReady, signedInUrl } from "./signed-in.ts";

export type Playability =
  | { ok: true; instance: CompanionInstance }
  | { ok: false; code: "age_restricted" | "unplayable"; reason: string };

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
  return ((await res.json()) as { playabilityStatus?: Status }).playabilityStatus ?? null;
}

const isAgeGate = (s: Status) => s.status === "LOGIN_REQUIRED" && /age|inappropriate/i.test(s.reason ?? "");

const playabilityCache = new TtlCache<Playability>(30 * 60_000, 1000);

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
      // Not cached: once age-restricted playback is set up, the next attempt should use it.
      queueMicrotask(() => playabilityCache.delete(id));
      return { ok: false, code: "age_restricted", reason: anon.reason ?? "Age-restricted." };
    }
    // Reported while the companion generates its first token; don't cache that.
    if (/token|not ready/i.test(anon.reason ?? "")) queueMicrotask(() => playabilityCache.delete(id));
    return { ok: false, code: "unplayable", reason: anon.reason ?? "This video can't be played." };
  });
}

type Range = { start: string; end: string };
type Format = {
  itag: number;
  url?: string;
  mimeType: string;
  bitrate: number;
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

type PlayerResponse = { streamingData?: { adaptiveFormats?: Format[] } };
const playerCache = new TtlCache<PlayerResponse>(60 * 60_000, 300);
const manifests = new TtlCache<string>(60 * 60_000, 300);

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

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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
export function dashManifest(id: string, origin: string): Promise<string> {
  return manifests.get(id, async () => {
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
      return proxyCompanion(`/companion/videoplayback?${u.searchParams}&host=${u.host}`, origin, play.instance);
    };
    let setId = 0;
    const adaptationSets = [...sets.entries()].map(([key, list]) => {
      const [mime, family] = key.split("|") as [string, string];
      const video = mime.startsWith("video/");
      const track = list[0]!.audioTrack;
      const lang = track?.id.split(".")[0];
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
        `    <AdaptationSet id="${setId++}" mimeType="${mime}" contentType="${video ? "video" : "audio"}" subsegmentAlignment="true" subsegmentStartsWithSAP="1"${lang ? ` lang="${xmlEscape(lang)}"` : ""} label="${family}">`,
        track ? `      <Role schemeIdUri="urn:mpeg:dash:role:2011" value="${track.audioIsDefault ? "main" : "alternate"}"/>` : "",
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
