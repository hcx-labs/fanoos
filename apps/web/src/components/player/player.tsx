import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Link, useNavigate } from "react-router";
import JASSUB from "jassub";
import { toast } from "sonner";
import jassubWorker from "jassub/dist/jassub-worker.js?url";
import jassubWasm from "jassub/dist/jassub-worker.wasm?url";
import jassubFont from "jassub/dist/default.woff2?url";
import {
  AudioLines,
  Captions,
  Palette,
  Check,
  ChevronLeft,
  ChevronRight,
  FastForward,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Rewind,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  RectangleHorizontal,
  Volume1,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { MediaPlayer, type MediaPlayerClass } from "dashjs";
import { SeekBar } from "@/components/player/seek-bar";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { formatDuration } from "@/lib/format";
import { segmentMeta } from "@/lib/segments";
import { itemKey, paths } from "@/lib/paths";
import { backendName, useAccounts, useProfile } from "@/lib/session";
import { useSource } from "@/lib/source";
import { actions, getLocalState, playbackScopes, trackPrefs, useSettings, useTrackPrefs, type Settings } from "@/lib/store";
import type { SubtitleStyle } from "@/lib/subtitle-style";
import type { Segment, Stream, Subtitle, Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { effectiveQuality } from "@/lib/quality";
import { SubtitleOverlay, SubtitleStyleMenu } from "./subtitles";
import { assHeight, assRestyle, type AssStyle } from "@/lib/subtitle-style";
import { createWatchMeter, type WatchMeter } from "@/lib/watch-meter";

import { initialSubtitle, subtitleKey, attachVtt, audioKey, audioOptions, preferredAudio, type AudioOption } from "@/lib/player-tracks";

export type PlayerHandle = { seek: (time: number) => void; play: () => void };

type Props = {
  video: Video;
  stream: Stream;
  /** Start here (seconds), e.g. from a shared link's t= parameter; overrides the saved position. */
  startAt?: number;
  next?: Video;
  theater: boolean;
  onTheaterChange: (theater: boolean) => void;
  onTime?: (time: number) => void;
  ref?: Ref<PlayerHandle>;
};

const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const noSubtitles: Subtitle[] = [];

type Osd = { icon: LucideIcon; label?: string; id: number };

/** Whether the device decodes this codec efficiently (in hardware) at 4K. */
async function efficient(contentType: string): Promise<boolean> {
  try {
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: "media-source",
      video: { contentType, width: 3840, height: 2160, bitrate: 20_000_000, framerate: 30 },
    });
    return info.supported && info.smooth && info.powerEfficient;
  } catch {
    return false;
  }
}

/**
 * Codec preference for this device. YouTube's 1440p/4K exist only in AV1 and VP9;
 * H.264 tops out at 1080p but plays smoothly everywhere. Apple M1/M2 decode VP9 in
 * hardware but not AV1, so they get VP9; newer chips get AV1.
 */
async function codecPreference(): Promise<RegExp[]> {
  const [av1, vp9] = await Promise.all([efficient('video/mp4; codecs="av01.0.12M.08"'), efficient('video/webm; codecs="vp09.00.51.08"')]);
  return [...(av1 ? [/av01/i] : []), ...(vp9 ? [/vp0?9/i] : []), /avc1/i];
}
type Notice = { segment: Segment; id: number };

type MenuView = "main" | "speed" | "quality" | "subtitles" | "subtitleStyle" | "audio";

const drmMessage = "This browser can't play protected video. Use Chrome, Edge or Firefox with protected content (DRM) allowed in its settings.";

const languageNames = (() => {
  try {
    return new Intl.DisplayNames([navigator.language, "en"], { type: "language" });
  } catch {
    return null;
  }
})();

const regionNames = (() => {
  try {
    return new Intl.DisplayNames([navigator.language, "en"], { type: "region" });
  } catch {
    return null;
  }
})();

/** Variants a service offers side by side, where the region is what tells them apart. */
const regional: Record<string, string> = { "es-419": "Latin America", "es-ES": "Spain", "pt-BR": "Brazil", "pt-PT": "Portugal", "fr-CA": "Canada", "zh-TW": "Taiwan", "zh-HK": "Hong Kong" };

/** "Japanese", "Spanish (Latin America)"… for a BCP 47 tag: the language, plus the region only where it matters. */
export const languageLabel = (locale: string) => {
  const [lang, region] = locale.split("-");
  const name = languageNames?.of(lang!) ?? locale;
  const where = regional[locale] ?? (region && locale in regional ? regionNames?.of(region) : undefined);
  return where ? `${name} (${where})` : name;
};

export function Player({ video, stream, startAt, next, theater, onTheaterChange, onTime, ref }: Props) {
  const settings = useSettings();
  const owner = useProfile()?.owner ?? false;
  const shell = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement>(null);
  const ambient = useRef<HTMLDivElement>(null);
  const dash = useRef<MediaPlayerClass | null>(null);
  const key = itemKey(video);
  const navigate = useNavigate();
  const source = useSource();
  const { bySlug, can } = useAccounts();
  const backend = bySlug(video.backend);
  const service = backendName(backend);
  const tracksProgress = can(video.backend, "progress");
  // Protected (DRM) video can't be drawn to a canvas, so there's no ambient glow for it.
  const protectedStream = Boolean(stream.drm?.widevine || stream.drm?.playready);
  const ambientOn = settings.ambient && !protectedStream;
  // Read once: where playback last stopped (saved to the account, or by the service itself).
  const [resumeAt] = useState(() => startAt ?? getLocalState().progress[key] ?? video.progress ?? 0);
  // ASS and native VTT subtitles, episode dubs and in-stream audio languages.
  const subtitles = stream.subtitles ?? noSubtitles;
  // Choices are remembered per season, show or channel (playbackScopes in store.ts).
  const scopeKey = playbackScopes(video).join("|");
  const scopes = useMemo(() => scopeKey.split("|"), [scopeKey]);
  const prefs = useTrackPrefs(scopes);
  const [subtitle, setSubtitle] = useState(() => initialSubtitle(subtitles, prefs.subtitles, video.episode?.audio, settings.captions, navigator.languages));
  const versions = video.episode?.versions ?? [];
  const chooseSubtitle = useCallback((id: string) => {
    setSubtitle(id);
    actions.trackPrefs(scopes, { subtitles: subtitles.find((t) => subtitleKey(t) === id)?.locale ?? "" });
  }, [subtitles, scopes]);
  useEffect(() => {
    setSubtitle(initialSubtitle(subtitles, trackPrefs(getLocalState(), scopes).subtitles, video.episode?.audio, settings.captions, navigator.languages));
    // Reset only for a new subtitle list/default, not when persisting a manual/ASR choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitles, settings.captions, video.episode?.audio]);
  const [streamAudio, setStreamAudio] = useState<AudioOption[]>([]);
  const [activeAudio, setActiveAudio] = useState("");
  const chooseStreamAudio = useCallback((key: string) => {
    const option = streamAudio.find((o) => o.key === key);
    if (!option || !dash.current) return;
    if (option.language) actions.trackPrefs(scopes, { audio: option.language });
    // dash.js switches the adaptation in-place: no seek, navigation, or play call.
    dash.current.setCurrentTrack(option.track);
  }, [streamAudio, scopes]);
  const switchAudio = useCallback(
    (id: string, audio: string) => {
      actions.trackPrefs(scopes, { audio });
      // Each dub is its own episode id: carry on from the same moment.
      navigate(paths.watch({ backend: video.backend, id }, media.current?.currentTime), { replace: true, state: { samePage: true } });
    },
    [navigate, video.backend, scopes],
  );
  const [heights, setHeights] = useState<number[]>([]);
  const [playingHeight, setPlayingHeight] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const lastSaved = useRef(0);
  const lastReported = useRef(0);
  // Watch time for Analytics, one meter per item; whatever is left is sent when leaving it.
  const meter = useRef<WatchMeter | null>(null);
  useEffect(() => {
    const m = createWatchMeter(video);
    meter.current = m;
    const close = () => m.close();
    addEventListener("pagehide", close);
    return () => {
      removeEventListener("pagehide", close);
      m.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [current, setCurrent] = useState(resumeAt);
  const [duration, setDuration] = useState(video.duration);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [segmentMuted, setSegmentMuted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [menu, setMenu] = useState<null | MenuView>(null);
  const [loop, setLoop] = useState(false);
  const [osd, setOsd] = useState<Osd | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const allowed = useRef(new Set<Segment>());
  const idleTimer = useRef<number>(undefined);

  const chapters = video.chapters ?? [];
  const activeSegments = (video.segments ?? []).filter((s) => settings.segments[s.category] !== "off");
  const chapter = [...chapters].reverse().find((c) => current >= c.start);
  const inShowSegment = activeSegments.find(
    (s) => settings.segments[s.category] === "show" && current >= s.start && current < s.end - 1,
  );

  const flash = useCallback((icon: LucideIcon, label?: string) => setOsd({ icon, label, id: Date.now() }), []);

  const seek = useCallback((time: number) => {
    const el = media.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, time), el.duration || time);
    setCurrent(el.currentTime);
    setEnded(false);
  }, []);

  const toggle = useCallback(() => {
    const el = media.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  useImperativeHandle(ref, () => ({ seek, play: () => void media.current?.play() }), [seek]);

  // Apply preferences.
  useEffect(() => {
    if (media.current) media.current.playbackRate = settings.speed;
  }, [settings.speed]);
  useEffect(() => {
    if (media.current) media.current.muted = muted || segmentMuted;
  }, [muted, segmentMuted]);
  useEffect(() => {
    if (media.current) media.current.volume = volume;
  }, [volume]);

  // Where to pick up when the stream is swapped under a mounted player (another audio language).
  const handoff = useRef<{ from: string; time: number; playing: boolean } | null>(null);

  // Attach the stream: DASH through dash.js, or a single progressive file.
  useEffect(() => {
    const el = media.current;
    if (!el) return;
    // Only a different stream continues from the old one; the same stream set up again
    // (React runs effects twice in development) starts where it should.
    const resume = handoff.current && handoff.current.from !== stream.dash ? handoff.current : null;
    handoff.current = null;
    setFailure(null);
    setHeights([]);
    setPlayingHeight(null);
    setStreamAudio([]);
    setActiveAudio("");
    if (stream.dash) {
      const player = MediaPlayer().create();
      let disposed = false;
      player.updateSettings({
        // No limitBitrateByPortal: in dash.js 5 it hides higher qualities entirely, which
        // also breaks manual 1440p/4K. Auto is capped to the player's size below instead.
        streaming: { buffer: { fastSwitchEnabled: true } },
      });
      // Encrypted streams: the browser's own CDM asks the licence URL (through Fanoos) for keys.
      if (stream.drm) {
        player.setProtectionData({
          ...(stream.drm.widevine ? { "com.widevine.alpha": { serverURL: new URL(stream.drm.widevine, location.origin).toString() } } : {}),
          ...(stream.drm.playready ? { "com.microsoft.playready": { serverURL: new URL(stream.drm.playready, location.origin).toString() } } : {}),
        });
      }
      const preference = codecPreference();
      // Where to start: the handed-over position (audio switch) or the saved one. dash.js's own
      // startTime is lost when the codec track switches below, so it's applied again after that.
      const start = (resume ? resume.time : resumeAt) || 0;
      let placed = !start;
      const place = () => {
        if (disposed || placed) return;
        placed = true;
        if (el.currentTime < start - 1) player.seek(start);
      };
      const syncAudio = () => {
        if (disposed) return;
        setStreamAudio(versions.length > 1 ? [] : audioOptions(player.getTracksFor("audio")));
        const current = player.getCurrentTrackFor("audio");
        setActiveAudio(current ? audioKey(current) : "");
      };
      player.on("currentTrackChanged", syncAudio);
      player.on("trackChangeRendered", syncAudio);
      player.on("streamInitialized", async () => {
        const options = audioOptions(player.getTracksFor("audio"));
        const currentAudio = player.getCurrentTrackFor("audio");
        const audio = preferredAudio(options, versions.length > 1 ? undefined : trackPrefs(getLocalState(), scopes).audio, currentAudio ? audioKey(currentAudio) : undefined);
        if (audio && (!currentAudio || audioKey(currentAudio) !== audio.key)) player.setCurrentTrack(audio.track);
        syncAudio();
        // One video track per codec: pick the first the device decodes efficiently.
        const tracks = player.getTracksFor("video");
        const order = await preference;
        if (disposed) return;
        const chosen = order.map((re) => tracks.find((t) => re.test(t.codec ?? ""))).find(Boolean) ?? tracks[0];
        if (chosen && chosen !== player.getCurrentTrackFor("video")) player.setCurrentTrack(chosen);
        place();
        setHeights([...new Set((chosen?.bitrateList ?? []).map((b) => b.height ?? 0))].filter(Boolean).sort((a, b) => b - a));
      });
      player.on("qualityChangeRendered", (e: { mediaType?: string }) => {
        if (e.mediaType === "video") setPlayingHeight(player.getCurrentRepresentationForType("video")?.height ?? null);
      });
      player.on("error", (e: { error?: { code?: number; message?: string } }) => {
        // Keep technical details out of the overlay; they're in the console for debugging.
        console.warn("Playback error", e.error);
        const code = e.error?.code ?? 0;
        // dash.js protection errors (100–115): no usable CDM, or the licence was refused.
        setFailure(
          code >= 100 && code < 120
            ? window.fanoosDesktop ? "Protected playback failed. Restart Fanoos and check that your Crunchyroll account can play this episode." : drmMessage
            : /not available|404|403|manifest/i.test(e.error?.message ?? "")
              ? "The stream couldn't be loaded. It may have expired; try again."
              : "Something went wrong while playing this video.",
        );
      });
      // Fallback: if the stream came up without the start position, put it there before playing.
      el.addEventListener("loadedmetadata", place, { once: true });
      const initialize = async () => {
        if (stream.drm?.widevine) {
          await window.fanoosDesktop?.readyForProtectedPlayback?.();
          if (disposed) return;
          if (!navigator.requestMediaKeySystemAccess) throw new Error(drmMessage);
          await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{ initDataTypes: ["cenc"], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"' }] }]);
          if (disposed) return;
        }
        player.initialize(el, stream.dash, resume?.playing ?? false, start || undefined);
      };
      void initialize().catch((error: Error) => {
        if (!disposed) setFailure(window.fanoosDesktop ? `Protected playback could not start. ${error.message}` : drmMessage);
      });
      dash.current = player;
      // Development aid: inspect playback from the browser console.
      if (import.meta.env.DEV) Object.assign(window, { __dash: player });
      return () => {
        disposed = true;
        el.removeEventListener("loadedmetadata", place);
        // If another stream replaces this one, carry on from here.
        handoff.current = { from: stream.dash!, time: el.currentTime, playing: !el.paused };
        dash.current = null;
        player.destroy();
      };
    }
    if (stream.progressive) {
      el.src = stream.progressive;
      const place = () => { el.currentTime = resumeAt; };
      if (resumeAt) el.addEventListener("loadedmetadata", place, { once: true });
      return () => {
        el.removeEventListener("loadedmetadata", place);
        el.pause();
        el.removeAttribute("src");
        el.load();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.dash, stream.progressive]);

  // VTT cues are timed by a hidden native track and drawn by SubtitleOverlay in the viewer's
  // style; ASS keeps its authored styling on the JASSUB canvas.
  const track = subtitles.find((t) => subtitleKey(t) === subtitle);
  const [vttTrack, setVttTrack] = useState<TextTrack | null>(null);
  // The styled-subtitle renderer and its script's own styles (for "Use for styled subtitles").
  const assRenderer = useRef<JASSUB | null>(null);
  const [assStyles, setAssStyles] = useState<AssStyle[] | null>(null);
  const assRestyled = useRef(false);
  useEffect(() => {
    const el = media.current;
    if (!el || !track) return;
    if (track.format === "vtt") return attachVtt(el, track, setVttTrack, () => {
      toast.error("Subtitles couldn't be loaded", { description: "Turn subtitles off and select the track again to retry." });
    });
    if (track.format !== "ass") return;
    let renderer: JASSUB | null = null;
    try {
      renderer = new JASSUB({
        video: el,
        subUrl: track.url,
        workerUrl: jassubWorker,
        wasmUrl: jassubWasm,
        availableFonts: { "liberation sans": jassubFont },
        fallbackFont: "liberation sans",
      });
      // The script's main style, which the viewer's style is sized against when overriding.
      // Only once the worker is ready: asked earlier, it fails.
      const created = renderer;
      created.addEventListener("ready", () =>
        created.getStyles((error, styles) => {
          if (!error && styles?.length && assRenderer.current === created) setAssStyles(styles as AssStyle[]);
        }),
      );
      assRenderer.current = renderer;
    } catch (error) {
      console.warn("Subtitles failed to start", error);
    }
    return () => {
      assRenderer.current = null;
      assRestyled.current = false;
      setAssStyles(null);
      renderer?.destroy();
    };
  }, [track]);

  // "Use for styled subtitles": rewrite the script's styles in the viewer's style; switching it
  // off puts the script's own back.
  const subtitleStyle = prefs.subtitleStyle;
  const setSubtitleStyle = useCallback((style: SubtitleStyle) => actions.trackPrefs(scopes, { subtitleStyle: style }), [scopes]);
  useEffect(() => {
    const renderer = assRenderer.current;
    if (!renderer || !assStyles) return;
    if (subtitleStyle.overrideStyled) {
      // libass keeps its own built-in "Default" at index 0; the script's styles follow it.
      const own = assStyles.length > 1 ? assStyles.slice(1) : assStyles;
      const main = own.find((st) => /^default$/i.test(st.Name)) ?? own[0]!;
      assStyles.forEach((original, i) => renderer.setStyle(assRestyle(subtitleStyle, original, assHeight(main)), i));
      assRestyled.current = true;
    } else if (assRestyled.current) {
      assStyles.forEach((original, i) => renderer.setStyle(original, i));
      assRestyled.current = false;
    }
  }, [assStyles, subtitleStyle]);

  // A service's playback session (stream limits): keep it alive while the page is open, end it on leave.
  useEffect(() => {
    const session = stream.session;
    if (!session || !started) return;
    const ping = () =>
      void fetch(`${session.keepAlive}?position=${Math.floor(media.current?.currentTime ?? 0)}`, { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
    const timer = session.keepAlive ? window.setInterval(ping, (session.everySeconds ?? 240) * 1000) : undefined;
    const release = () => {
      if (session.release) void fetch(session.release, { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
    };
    addEventListener("pagehide", release);
    return () => {
      window.clearInterval(timer);
      removeEventListener("pagehide", release);
      release();
    };
  }, [stream.session, started]);

  // The player's height in device pixels, so Auto never fetches more than it can show.
  const [portal, setPortal] = useState(0);
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const px = Math.round((entry?.contentRect.height ?? 0) * devicePixelRatio);
      // Round up to a common height so small resizes don't re-trigger quality changes.
      setPortal([144, 240, 360, 480, 720, 1080, 1440, 2160, 4320].find((h) => h >= px) ?? 4320);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Apply the preferred quality: a chosen height (closest at or below it), or Auto capped to the player's size.
  useEffect(() => {
    const player = dash.current;
    if (!player || !heights.length) return;
    // Lift any cap first: dash.js leaves capped qualities out of the list.
    player.updateSettings({ streaming: { abr: { maxBitrate: { video: -1 } } } });
    const reps = player.getRepresentationsByType("video");
    const quality = effectiveQuality(settings.quality, heights);
    if (quality === "auto") {
      const fit = reps.filter((r) => r.height >= portal).sort((a, b) => a.height - b.height || b.bandwidth - a.bandwidth)[0];
      player.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: true }, maxBitrate: { video: fit && portal ? Math.ceil(fit.bandwidth / 1000) : -1 } } },
      });
      return;
    }
    player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
    const target = Number.parseInt(quality, 10);
    const rep = reps.filter((r) => r.height === target).sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (rep) player.setRepresentationForTypeById("video", rep.id, true);
  }, [settings.quality, heights, portal]);

  // Segment handling: skip, mute, or offer a skip button.
  useEffect(() => {
    let mute = false;
    for (const segment of activeSegments) {
      if (current < segment.start || current >= segment.end) continue;
      const action = settings.segments[segment.category];
      if (action === "skip" && !allowed.current.has(segment) && playing && !scrubbing) {
        meter.current?.skipped(current, segment.end);
        seek(segment.end);
        setNotice({ segment, id: Date.now() });
      }
      if (action === "mute") mute = true;
    }
    setSegmentMuted(mute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, playing, scrubbing, settings.segments]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!osd) return;
    const timer = window.setTimeout(() => setOsd(null), 650);
    return () => window.clearTimeout(timer);
  }, [osd]);

  // Ambient glow: four times a second, paint a tiny copy of the frame behind the player and let
  // CSS blur it. Two canvases take turns: each new frame fades in over the previous one, which
  // stays opaque underneath, so colours drift instead of jumping and the glow never dims mid-fade
  // (the fade is done by the compositor, so it costs next to nothing). Paused or in a hidden tab,
  // it paints only when the frame changes (a seek).
  useEffect(() => {
    if (!ambientOn) return;
    const el = media.current;
    const canvases = [...(ambient.current?.querySelectorAll("canvas") ?? [])];
    if (!el || canvases.length !== 2) return;
    let front = 0;
    const paint = () => {
      const next = canvases[1 - front]!;
      const current = canvases[front]!;
      try {
        next.getContext("2d")?.drawImage(el, 0, 0, next.width, next.height);
      } catch {
        return;
      }
      // Hidden behind the current frame, reset the next one to transparent, then fade it in on top.
      next.style.transition = "none";
      next.style.opacity = "0";
      next.style.zIndex = "1";
      current.style.zIndex = "0";
      void next.offsetWidth;
      next.style.transition = "";
      next.style.opacity = "1";
      front = 1 - front;
    };
    let timer: number | undefined;
    const sync = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (playing && !document.hidden) timer = window.setInterval(paint, 250);
    };
    paint();
    sync();
    el.addEventListener("seeked", paint);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      el.removeEventListener("seeked", paint);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ambientOn, started, playing]);

  // Autoplay countdown at the end.
  useEffect(() => {
    if (!ended || !next || !settings.autoplayNext) return setCountdown(null);
    setCountdown(8);
    const timer = window.setInterval(() => setCountdown((n) => (n === null ? null : Math.max(0, n - 1))), 1000);
    return () => window.clearInterval(timer);
  }, [ended, next, settings.autoplayNext]);

  // Fullscreen state.
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen();
  }, []);

  const togglePip = useCallback(() => {
    const el = media.current;
    if (!el) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void el.requestPictureInPicture?.();
  }, []);

  const setSpeed = useCallback(
    (speed: number) => {
      actions.setting("speed", speed);
      flash(Gauge, `${speed}×`);
    },
    [flash],
  );

  // Keyboard shortcuts (YouTube-compatible where it makes sense).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target.closest("[role=dialog], [role=menu]")) return;
      const el = media.current;
      if (!el) return;
      const key = event.key;
      switch (key) {
        case " ":
          if (target.tagName === "BUTTON" || target.getAttribute("role") === "slider") return;
        // falls through
        case "k":
          toggle();
          flash(el.paused ? Play : Pause);
          break;
        case "j":
        case "ArrowLeft":
          seek(el.currentTime - (key === "j" ? 10 : 5));
          flash(Rewind, key === "j" ? "10s" : "5s");
          break;
        case "l":
        case "ArrowRight":
          seek(el.currentTime + (key === "l" ? 10 : 5));
          flash(FastForward, key === "l" ? "10s" : "5s");
          break;
        case "ArrowUp":
        case "ArrowDown": {
          const v = Math.min(1, Math.max(0, volume + (key === "ArrowUp" ? 0.05 : -0.05)));
          setVolume(v);
          setMuted(false);
          flash(v === 0 ? VolumeX : Volume2, `${Math.round(v * 100)}%`);
          break;
        }
        case "m":
          setMuted((m) => !m);
          flash(muted ? Volume2 : VolumeX);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "t":
          onTheaterChange(!theater);
          break;
        case "i":
          togglePip();
          break;
        case "c":
          if (!subtitles.length) return;
          // On: the last language chosen, else the browser's, else the first track.
          chooseSubtitle(
            subtitle
              ? ""
              : initialSubtitle(subtitles, prefs.subtitles || undefined, undefined, true, navigator.languages) || subtitleKey(subtitles[0]!),
          );
          flash(Captions, subtitle ? "Off" : "On");
          break;
        case "+":
        case "=":
        case "-": {
          // Caption size, like YouTube.
          const style = trackPrefs(getLocalState(), scopes).subtitleStyle;
          const size = Math.min(2.5, Math.max(0.5, Math.round((style.size + (key === "-" ? -0.1 : 0.1)) * 10) / 10));
          actions.trackPrefs(scopes, { subtitleStyle: { ...style, size } });
          flash(Captions, `${Math.round(size * 100)}%`);
          break;
        }
        case ">":
        case "<": {
          const index = speeds.indexOf(settings.speed);
          const nextSpeed = speeds[Math.min(speeds.length - 1, Math.max(0, (index < 0 ? 3 : index) + (key === ">" ? 1 : -1)))]!;
          setSpeed(nextSpeed);
          break;
        }
        case ",":
        case ".":
          if (!el.paused) return;
          seek(el.currentTime + (key === "." ? 1 / 30 : -1 / 30));
          break;
        default:
          if (/^[0-9]$/.test(key)) {
            seek((Number(key) / 10) * el.duration);
            break;
          }
          return;
      }
      event.preventDefault();
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, muted, theater, settings.speed, toggle, seek, flash, toggleFullscreen, togglePip, setSpeed, onTheaterChange, subtitle, subtitles, chooseSubtitle]);

  const wake = () => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2600);
  };

  const chrome = !playing || !idle || menu !== null || scrubbing;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="relative">
      {/* Extends only vertically: a box wider than the player would widen the page. The blur still spreads sideways. */}
      {ambientOn && (
        <div
          ref={ambient}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -inset-y-[8%] -z-10 h-[116%] w-full opacity-60 blur-[70px] saturate-150 dark:opacity-70"
        >
          {[0, 1].map((i) => (
            <canvas key={i} width={32} height={18} className="absolute inset-0 size-full opacity-0 transition-opacity duration-200 ease-linear" />
          ))}
        </div>
      )}
      <div
        ref={shell}
        className={cn(
          "group/player relative isolate aspect-video w-full overflow-hidden bg-black text-white select-none [container-type:size]",
          // Theater is the same rounded player, just spanning both columns.
          "rounded-2xl shadow-2xl shadow-black/30",
          theater && "mx-auto max-w-[calc((100dvh-7rem)*16/9)]",
          fullscreen && "max-w-none rounded-none shadow-none",
          !chrome && "cursor-none",
        )}
        onPointerMove={wake}
        onPointerLeave={() => playing && setIdle(true)}
      >
        <video
          ref={media}
          poster={video.thumbnail}
          playsInline
          preload="metadata"
          loop={loop}
          // YouTube's 4:3 fallback posters contain black bars around a 16:9 image.
          // Fill the poster area, but never crop the video once playback starts.
          className={cn("size-full", started ? "object-contain" : "object-cover")}
          onClick={() => {
            if (menu) return setMenu(null);
            toggle();
          }}
          onDoubleClick={toggleFullscreen}
          onPlay={() => {
            setPlaying(true);
            setStarted(true);
            setEnded(false);
            wake();
            actions.watched(key);
          }}
          onPause={(e) => {
            setPlaying(false);
            meter.current?.pause();
            actions.saveProgress(key, e.currentTarget.currentTime, e.currentTarget.duration);
            if (tracksProgress) void source.progress(video, e.currentTarget.currentTime);
          }}
          onSeeking={() => meter.current?.jump()}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onEnded={(e) => {
            setEnded(true);
            setPlaying(false);
            meter.current?.finish();
            actions.saveProgress(key, 0, 0);
            if (tracksProgress) void source.progress(video, e.currentTarget.duration);
          }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setCurrent(t);
            if (!e.currentTarget.paused) meter.current?.tick(t, e.currentTarget.playbackRate, e.currentTarget.duration);
            onTime?.(t);
            // Save the position every few seconds for resuming and "Continue watching".
            if (Math.abs(t - lastSaved.current) > 5) {
              lastSaved.current = t;
              actions.saveProgress(key, t, e.currentTarget.duration);
            }
            // Services that keep their own history hear about it every 30 s.
            if (tracksProgress && Math.abs(t - lastReported.current) > 30) {
              lastReported.current = t;
              void source.progress(video, t);
            }
          }}
          onProgress={(e) => {
            const b = e.currentTarget.buffered;
            if (b.length) setBuffered(b.end(b.length - 1));
          }}
          onVolumeChange={(e) => {
            if (!segmentMuted) setMuted(e.currentTarget.muted);
          }}
        />
        {vttTrack && <SubtitleOverlay track={vttTrack} style={subtitleStyle} lifted={chrome} />}

        {/* No playable stream (live) or a playback failure. */}
        {(failure || (!stream.dash && !stream.progressive)) && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/80 p-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="font-semibold">
                {failure
                  ? "This video couldn't be played"
                  : {
                      age_restricted: `Age-restricted on ${service}`,
                      starting: "Getting ready to stream",
                      bot_check: `${service} wants this server to sign in`,
                      live: "Live streams aren't supported yet",
                      unplayable: "This video can't be played here",
                    }[stream.unavailable?.code ?? "unplayable"]}
              </p>
              <p className="text-sm text-white/70">
                {failure ??
                  (stream.unavailable?.code === "age_restricted"
                    ? `${service} only streams this video to signed-in, age-verified accounts, so it has to be watched on ${service}.`
                    : (stream.unavailable?.reason ?? `${service} didn't offer a stream for this video.`))}
              </p>
              {!failure && stream.unavailable?.code === "starting" && (
                <p className="flex items-center justify-center gap-2 text-xs text-white/60" aria-live="polite">
                  <span className="border-t-brand size-3.5 animate-spin rounded-full border-2 border-white/20" />
                  It'll start on its own as soon as the stream is ready.
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {!failure && (stream.unavailable?.code === "age_restricted" || stream.unavailable?.code === "bot_check") && owner && (
                  <Link to="/settings#age-restricted" className="bg-brand text-brand-foreground rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-90">
                    Set up signed-in playback
                  </Link>
                )}
                {failure && (
                  <button type="button" className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25" onClick={() => location.reload()}>
                    Try again
                  </button>
                )}
                {backend?.info?.urls.video && (
                  <a
                    className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25"
                    href={backend.info.urls.video.replace("{id}", encodeURIComponent(video.id))}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open on {service}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Big play button before the first play. */}
        {!started && (
          <button
            type="button"
            onClick={() => void media.current?.play()}
            className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/60 via-black/10 to-black/20"
            aria-label="Play"
          >
            <span className="bg-brand text-brand-foreground grid size-20 place-items-center rounded-full shadow-2xl transition-transform hover:scale-105">
              <Play className="ml-1 size-9 fill-current" />
            </span>
            {resumeAt ? (
              <span className="absolute bottom-24 rounded-full bg-black/60 px-3 py-1 text-xs backdrop-blur">
                {startAt ? "Starting at" : "Resuming at"} {formatDuration(resumeAt)}
              </span>
            ) : null}
          </button>
        )}

        {waiting && playing && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="border-t-brand size-12 animate-spin rounded-full border-4 border-white/20" />
          </div>
        )}

        {/* On-screen feedback for keyboard actions. */}
        {osd && (
          <div key={osd.id} className="animate-in fade-in zoom-in-90 pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-1 rounded-2xl bg-black/55 px-5 py-4 backdrop-blur">
              <osd.icon className="size-8" />
              {osd.label && <span className="text-sm font-semibold tabular-nums">{osd.label}</span>}
            </div>
          </div>
        )}

        {/* Skipped-segment notice with undo. */}
        {notice && (
          <div
            key={notice.id}
            className="animate-in slide-in-from-left-4 fade-in absolute top-4 left-4 z-20 flex items-center gap-3 rounded-xl bg-black/75 py-2 pr-2 pl-3 text-sm shadow-lg backdrop-blur"
          >
            <span className="size-2.5 rounded-full" style={{ background: segmentMeta[notice.segment.category].color }} />
            <span>
              Skipped {segmentMeta[notice.segment.category].label.toLowerCase()}
              <span className="text-white/60"> · {Math.round(notice.segment.end - notice.segment.start)}s</span>
            </span>
            <button
              type="button"
              className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
              onClick={() => {
                allowed.current.add(notice.segment);
                seek(notice.segment.start);
                setNotice(null);
              }}
            >
              Undo
            </button>
          </div>
        )}

        {/* Manual skip for categories set to "show". */}
        {inShowSegment && (
          <button
            type="button"
            onClick={() => seek(inShowSegment.end)}
            className="animate-in fade-in slide-in-from-right-4 absolute right-4 bottom-28 z-20 flex items-center gap-2 rounded-xl border border-white/20 bg-black/70 px-4 py-2.5 text-sm font-semibold backdrop-blur hover:bg-black/85"
          >
            Skip {segmentMeta[inShowSegment.category].label.toLowerCase()}
            <SkipForward className="size-4" />
          </button>
        )}

        {/* End screen. */}
        {ended && !loop && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-5 px-6 text-center">
              {next && (
                <Link to={paths.watch(next)} className="group/next flex w-72 flex-col gap-3 text-left">
                  <span className="text-xs font-medium tracking-wide text-white/60 uppercase">
                    {countdown !== null ? `Up next in ${countdown}` : "Up next"}
                  </span>
                  <img src={next.thumbnail} alt="" referrerPolicy="no-referrer" className="aspect-video w-full rounded-xl object-cover ring-white/0 transition group-hover/next:ring-4 group-hover/next:ring-white/30" />
                  <span className="line-clamp-2 font-semibold">{next.title}</span>
                </Link>
              )}
              <button type="button" onClick={() => {
                  seek(0);
                  void media.current?.play();
                }} className="flex items-center gap-2 text-sm text-white/80 hover:text-white">
                <RotateCcw className="size-4" /> Watch again
              </button>
            </div>
          </div>
        )}

        {/* Controls. */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pt-16 pb-2 transition-opacity duration-300 sm:px-4",
            chrome && started ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <SeekBar
            duration={duration}
            current={current}
            buffered={buffered}
            chapters={chapters}
            segments={activeSegments}
            onSeek={seek}
            onScrub={setScrubbing}
          />
          <div className="mt-1 flex items-center gap-0.5 sm:gap-1">
            <Control label={playing ? "Pause (k)" : "Play (k)"} onClick={toggle}>
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </Control>
            {next && (
              <Control label="Next" asLink={paths.watch(next)}>
                <SkipForward className="fill-current" />
              </Control>
            )}
            <div className="group/volume flex items-center">
              <Control label={muted ? "Unmute (m)" : "Mute (m)"} onClick={() => setMuted((m) => !m)}>
                <VolumeIcon />
              </Control>
              <div className="w-0 overflow-hidden transition-[width] duration-200 group-focus-within/volume:w-24 group-hover/volume:w-24">
                <Slider
                  aria-label="Volume"
                  value={[muted ? 0 : volume * 100]}
                  max={100}
                  step={1}
                  onValueChange={([v]) => {
                    setVolume((v ?? 0) / 100);
                    setMuted(v === 0);
                  }}
                  className="mx-2 w-20 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-track]]:bg-white/30"
                />
              </div>
            </div>
            <span className="ml-1 text-xs whitespace-nowrap text-white/90 tabular-nums sm:text-[13px]">
              {formatDuration(current)} <span className="text-white/50">/ {formatDuration(duration)}</span>
            </span>
            {chapter && chapters.length > 1 && (
              <span className="ml-2 hidden min-w-0 items-center gap-1 truncate text-[13px] text-white/80 lg:flex">
                <span className="text-white/40">·</span>
                <span className="truncate">{chapter.title}</span>
              </span>
            )}

            <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
              {activeSegments.some((s) => settings.segments[s.category] === "skip") && (
                <span
                  className="mr-1 hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85 sm:flex"
                  title="SponsorBlock segments on this video"
                >
                  <ShieldCheck className="text-brand size-3.5" />
                  {activeSegments.filter((s) => settings.segments[s.category] === "skip").length} auto-skip
                </span>
              )}
              {settings.speed !== 1 && (
                <button type="button" onClick={() => setSpeed(1)} className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums hover:bg-white/25">
                  {settings.speed}×
                </button>
              )}
              {/* Subtitles live in Settings (and on c); no separate button. */}
              <div className="relative">
                <Control label="Settings" onClick={() => setMenu((m) => (m ? null : "main"))} pressed={menu !== null}>
                  <Settings2 className={cn("transition-transform duration-300", menu && "rotate-45")} />
                </Control>
                {menu && (
                  <SettingsPanel
                    subtitles={subtitles}
                    subtitle={subtitle}
                    onSubtitle={chooseSubtitle}
                    streamAudio={streamAudio}
                    activeAudio={activeAudio}
                    onStreamAudio={chooseStreamAudio}
                    versions={versions}
                    audio={video.episode?.audio}
                    onAudio={switchAudio}
                    heights={heights}
                    playingHeight={playingHeight}
                    view={menu}
                    onView={setMenu}
                    settings={settings}
                    subtitleStyle={subtitleStyle}
                    onSubtitleStyle={setSubtitleStyle}
                    loop={loop}
                    onLoop={setLoop}
                    onSpeed={setSpeed}
                  />
                )}
              </div>
              <Control label="Picture in picture (i)" onClick={togglePip} className="hidden sm:grid">
                <PictureInPicture2 />
              </Control>
              {!fullscreen && (
                <Control label={theater ? "Default view (t)" : "Theater mode (t)"} onClick={() => onTheaterChange(!theater)} className="hidden md:grid">
                  <RectangleHorizontal className={cn(theater && "scale-x-75")} />
                </Control>
              )}
              <Control label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize /> : <Maximize />}
              </Control>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Control({
  label,
  children,
  onClick,
  asLink,
  pressed,
  disabled,
  className,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  asLink?: string;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const classes = cn(
    "group/control relative grid size-9 place-items-center rounded-lg text-white/90 transition hover:bg-white/10 hover:text-white disabled:opacity-40 [&_svg]:size-5 sm:size-10",
    pressed && "bg-white/15",
    className,
  );
  // Tooltips are drawn inside the player so they still show in full screen.
  const tip = (
    <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md bg-black/85 px-2 py-1 text-xs font-medium whitespace-nowrap opacity-0 transition-opacity group-hover/control:opacity-100 group-focus-visible/control:opacity-100">
      {label}
    </span>
  );
  if (asLink)
    return (
      <Link to={asLink} aria-label={label} className={classes}>
        {children}
        {tip}
      </Link>
    );
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled} className={classes}>
      {children}
      {tip}
    </button>
  );
}

function SettingsPanel({
  subtitles,
  subtitle,
  onSubtitle,
  versions,
  streamAudio,
  activeAudio,
  onStreamAudio,
  audio,
  onAudio,
  heights,
  playingHeight,
  view,
  onView,
  settings,
  subtitleStyle,
  onSubtitleStyle,
  loop,
  onLoop,
  onSpeed,
}: {
  subtitles: Subtitle[];
  subtitle: string;
  onSubtitle: (locale: string) => void;
  streamAudio: AudioOption[];
  activeAudio: string;
  onStreamAudio: (key: string) => void;
  versions: { audio: string; id: string; original?: boolean }[];
  audio?: string;
  onAudio: (id: string, audio: string) => void;
  heights: number[];
  playingHeight: number | null;
  view: MenuView;
  onView: (view: null | MenuView) => void;
  settings: Settings;
  subtitleStyle: SubtitleStyle;
  onSubtitleStyle: (style: SubtitleStyle) => void;
  loop: boolean;
  onLoop: (loop: boolean) => void;
  onSpeed: (speed: number) => void;
}) {
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10";
  const skipping = Object.values(settings.segments).some((a) => a === "skip");
  const qualityForVideo = effectiveQuality(settings.quality, heights);
  return (
    <div
      role="menu"
      className="animate-in fade-in slide-in-from-bottom-2 absolute right-0 bottom-full z-10 mb-3 max-h-[calc(100cqh-5.5rem)] w-72 overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-neutral-900/90 p-1.5 shadow-2xl backdrop-blur-xl"
      onKeyDown={(e) => e.key === "Escape" && onView(null)}
    >
      {view === "main" && (
        <>
          {(versions.length > 1 || streamAudio.length > 1) && (
            <button type="button" className={row} onClick={() => onView("audio")}>
              <AudioLines className="size-4 text-white/70" /> Audio
              <span className="ml-auto truncate text-white/60">{streamAudio.find((o) => o.key === activeAudio)?.label ?? (audio ? languageLabel(audio) : "Original")}</span>
              <ChevronRight className="size-4 text-white/40" />
            </button>
          )}
          {subtitles.length > 0 && (
            <button type="button" className={row} onClick={() => onView("subtitles")}>
              <Captions className="size-4 text-white/70" /> Subtitles
              <span className="ml-auto truncate text-white/60">{subtitle ? (subtitles.find((t) => subtitleKey(t) === subtitle)?.label ?? subtitle) : "Off"}</span>
              <ChevronRight className="size-4 text-white/40" />
            </button>
          )}
          <button type="button" className={row} onClick={() => onView("speed")}>
            <Gauge className="size-4 text-white/70" /> Playback speed
            <span className="ml-auto text-white/60 tabular-nums">{settings.speed === 1 ? "Normal" : `${settings.speed}×`}</span>
            <ChevronRight className="size-4 text-white/40" />
          </button>
          <button type="button" className={row} onClick={() => onView("quality")}>
            <Sparkles className="size-4 text-white/70" /> Quality
            <span className="ml-auto text-white/60">
              {qualityForVideo === "auto" ? `Auto${playingHeight ? ` (${playingHeight}p)` : ""}` : qualityForVideo}
            </span>
            <ChevronRight className="size-4 text-white/40" />
          </button>
          <div className="my-1 h-px bg-white/10" />
          <label className={row}>
            <ShieldCheck className="size-4 text-white/70" /> Skip sponsors
            <Switch
              className="ml-auto"
              checked={skipping}
              onCheckedChange={(on) => {
                actions.segment("sponsor", on ? "skip" : "show");
                actions.segment("selfpromo", on ? "skip" : "show");
                actions.segment("interaction", on ? "skip" : "show");
              }}
            />
          </label>
          <label className={row}>
            <Sparkles className="size-4 text-white/70" /> Ambient mode
            <Switch className="ml-auto" checked={settings.ambient} onCheckedChange={(on) => actions.setting("ambient", on)} />
          </label>
          <label className={row}>
            <Repeat className="size-4 text-white/70" /> Loop
            <Switch className="ml-auto" checked={loop} onCheckedChange={onLoop} />
          </label>
          <label className={row}>
            <SkipForward className="size-4 text-white/70" /> Autoplay next
            <Switch className="ml-auto" checked={settings.autoplayNext} onCheckedChange={(on) => actions.setting("autoplayNext", on)} />
          </label>
        </>
      )}
      {view === "speed" && (
        <>
          <button type="button" className={cn(row, "font-semibold")} onClick={() => onView("main")}>
            <ChevronLeft className="size-4" /> Playback speed
          </button>
          <div className="my-1 h-px bg-white/10" />
          <div className="px-3 pt-2 pb-3">
            <div className="mb-3 text-center text-2xl font-semibold tabular-nums">{settings.speed.toFixed(2)}×</div>
            <Slider
              aria-label="Playback speed"
              value={[settings.speed]}
              min={0.25}
              max={3}
              step={0.05}
              onValueChange={([v]) => onSpeed(Math.round((v ?? 1) * 100) / 100)}
              className="[&_[data-slot=slider-range]]:bg-brand [&_[data-slot=slider-track]]:bg-white/20"
            />
          </div>
          <div className="grid grid-cols-5 gap-1 px-1 pb-1">
            {speeds.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => onSpeed(speed)}
                className={cn(
                  "rounded-md py-1.5 text-xs font-medium tabular-nums hover:bg-white/10",
                  settings.speed === speed && "bg-brand text-brand-foreground hover:bg-brand",
                )}
              >
                {speed === 1 ? "1×" : speed}
              </button>
            ))}
          </div>
        </>
      )}
      {view === "subtitles" && (
        <>
          <button type="button" className={cn(row, "font-semibold")} onClick={() => onView("main")}>
            <ChevronLeft className="size-4" /> Subtitles
          </button>
          <div className="my-1 h-px bg-white/10" />
          {[{ id: "", locale: "", label: "Off" }, ...subtitles].map((t) => (
            <button key={subtitleKey(t) || "off"} type="button" role="menuitemradio" aria-checked={subtitle === subtitleKey(t)} className={row} onClick={() => onSubtitle(subtitleKey(t))}>
              <Check className={cn("size-4", subtitle === subtitleKey(t) ? "text-brand" : "opacity-0")} />
              {t.label}
            </button>
          ))}
          <div className="my-1 h-px bg-white/10" />
          <button type="button" className={row} onClick={() => onView("subtitleStyle")}>
            <Palette className="size-4 text-white/70" /> Style
            <ChevronRight className="ml-auto size-4 text-white/40" />
          </button>
        </>
      )}
      {view === "subtitleStyle" && (
        <>
          <button type="button" className={cn(row, "font-semibold")} onClick={() => onView("subtitles")}>
            <ChevronLeft className="size-4" /> Subtitle style
          </button>
          <div className="my-1 h-px bg-white/10" />
          <SubtitleStyleMenu style={subtitleStyle} onChange={onSubtitleStyle} />
        </>
      )}
      {view === "audio" && (
        <>
          <button type="button" className={cn(row, "font-semibold")} onClick={() => onView("main")}>
            <ChevronLeft className="size-4" /> Audio
          </button>
          <div className="my-1 h-px bg-white/10" />
          {streamAudio.map((option) => (
            <button key={option.key} type="button" role="menuitemradio" aria-checked={activeAudio === option.key} className={row} onClick={() => activeAudio !== option.key && onStreamAudio(option.key)}>
              <Check className={cn("size-4", activeAudio === option.key ? "text-brand" : "opacity-0")} />
              {option.label}
            </button>
          ))}
          {[...versions]
            .sort((a, b) => Number(Boolean(b.original)) - Number(Boolean(a.original)) || languageLabel(a.audio).localeCompare(languageLabel(b.audio)))
            .map((v) => (
              <button key={v.id} type="button" className={row} onClick={() => v.audio !== audio && onAudio(v.id, v.audio)}>
                <Check className={cn("size-4", v.audio === audio ? "text-brand" : "opacity-0")} />
                {languageLabel(v.audio)}
                {v.original && <span className="ml-auto text-[10px] font-bold text-white/50 uppercase">Original</span>}
              </button>
            ))}
        </>
      )}
      {view === "quality" && (
        <>
          <button type="button" className={cn(row, "font-semibold")} onClick={() => onView("main")}>
            <ChevronLeft className="size-4" /> Quality
          </button>
          <div className="my-1 h-px bg-white/10" />
          {["auto", ...heights.map((h) => `${h}p`)].map((quality) => (
            <button
              key={quality}
              type="button"
              role="menuitemradio"
              aria-checked={qualityForVideo === quality}
              className={row}
              onClick={() => {
                actions.setting("quality", quality);
                onView("main");
              }}
            >
              <Check className={cn("size-4", qualityForVideo === quality ? "text-brand" : "opacity-0")} />
              {quality === "auto" ? "Auto" : quality}
              {quality !== "auto" && (
                <span className="ml-auto text-[10px] font-bold text-white/50">
                  {Number.parseInt(quality, 10) >= 2160 ? "4K" : Number.parseInt(quality, 10) >= 720 ? "HD" : ""}
                </span>
              )}
            </button>
          ))}
          {!heights.length && <p className="px-3 py-2 text-xs text-white/60">Qualities appear once the video loads.</p>}
        </>
      )}
    </div>
  );
}
