/*
 * App data saved to the signed-in Fanoos account: preferences, watch history,
 * playback positions, Watch later, recent searches and hidden channels. Loaded when
 * the session starts (session.ts) and saved back shortly after each change, so every
 * device signed in to the account shares it. Only the theme stays per-browser (theme.tsx).
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, RequestError } from "./api";
import { resumePosition, mergeOfflineProgress } from "./progress";
import { storageKey } from "./brand";
import { defaultSubtitleStyle, normalizeSubtitleStyle, type SubtitleStyle } from "./subtitle-style";
import type { SegmentCategory, Video } from "./types";

export type SegmentAction = "skip" | "mute" | "show" | "off";

export type Settings = {
  segments: Record<SegmentCategory, SegmentAction>;
  dislikes: boolean;
  dearrow: boolean;
  hideWatched: boolean;
  autoplayNext: boolean;
  ambient: boolean;
  speed: number;
  /** "auto" or a preferred height such as "1080p". */
  quality: string;
  proxyMedia: boolean;
  keepHistory: boolean;
  keepSearches: boolean;
  captions: boolean;
  /** How caption text looks (subtitle-style.ts). */
  subtitleStyle: SubtitleStyle;
  feedLayout: "grid" | "list";
};

/**
 * Items and channels are stored by key, "<backend>/<id>" (see itemKey in paths.ts), so lists can
 * hold YouTube videos and Crunchyroll episodes side by side.
 */
type State = {
  settings: Settings;
  watchLater: string[];
  /** Seconds watched per item, for resuming and "Continue watching". */
  progress: Record<string, number>;
  history: { id: string; at: string }[];
  searches: string[];
  /** Hidden channels and shows. */
  muted: string[];
  /** Last-chosen audio and subtitle languages anywhere ("ja-JP", "en-US"; "" = off): the fallback for new shows and channels. */
  languages?: { audio?: string; subtitles?: string };
  /** Choices made while watching, per season, show or channel (playbackScopes), most recent last. */
  scoped?: Record<string, TrackPrefs>;
};

export type TrackPrefs = { audio?: string; subtitles?: string; subtitleStyle?: SubtitleStyle };

const MAX_SCOPES = 300;

/**
 * Where a video's track choices are remembered, most specific first: an episode's season, then
 * its show; a video's channel.
 */
export function playbackScopes(video: Pick<Video, "backend" | "channelId" | "episode">): string[] {
  const e = video.episode;
  if (!e) return [`${video.backend}/channel/${video.channelId}`];
  return [...(e.seasonId ? [`${video.backend}/season/${e.seasonId}`] : []), `${video.backend}/show/${e.seriesId}`];
}

/** The first scope that has `field`, if any. */
function scoped<K extends keyof TrackPrefs>(s: State, scopes: string[], field: K): TrackPrefs[K] | undefined {
  for (const scope of scopes) {
    const value = s.scoped?.[scope]?.[field];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Track choices for these scopes, falling back to the last choice anywhere. */
export function trackPrefs(s: State, scopes: string[]): Required<Pick<TrackPrefs, "subtitleStyle">> & Pick<TrackPrefs, "audio" | "subtitles"> {
  return {
    audio: scoped(s, scopes, "audio") ?? s.languages?.audio,
    subtitles: scoped(s, scopes, "subtitles") ?? s.languages?.subtitles,
    subtitleStyle: scoped(s, scopes, "subtitleStyle") ?? s.settings.subtitleStyle,
  };
}

/** The audio language chosen for these scopes themselves, without the global fallback. */
export const scopedAudio = (s: State, scopes: string[]) => scoped(s, scopes, "audio");

const defaults: State = {
  settings: {
    segments: {
      sponsor: "skip",
      selfpromo: "skip",
      interaction: "skip",
      intro: "show",
      outro: "show",
      preview: "show",
      filler: "off",
      music_offtopic: "skip",
    },
    dislikes: true,
    dearrow: true,
    hideWatched: false,
    autoplayNext: false,
    ambient: true,
    speed: 1,
    quality: "auto",
    proxyMedia: true,
    keepHistory: true,
    keepSearches: true,
    captions: false,
    subtitleStyle: defaultSubtitleStyle,
    feedLayout: "grid",
  },
  progress: {},
  watchLater: [],
  history: [],
  searches: [],
  muted: [],
};

/** Where this browser kept the data before it moved to the account; uploaded once, then removed. */
const LEGACY_KEY = storageKey("local.v1");

/** Keys saved before backends had names are YouTube ones. */
const keyed = (key: string) => (key.includes("/") ? key : `youtube/${key}`);

function normalize(saved: Partial<State> | null | undefined): State {
  if (!saved) return defaults;
  return {
    ...defaults,
    ...saved,
    progress: Object.fromEntries(Object.entries(saved.progress ?? {}).map(([k, v]) => [keyed(k), v])),
    history: (saved.history ?? []).map((h) => ({ ...h, id: keyed(h.id) })),
    watchLater: (saved.watchLater ?? []).map(keyed),
    muted: (saved.muted ?? []).map(keyed),
    settings: {
      ...defaults.settings,
      ...saved.settings,
      segments: { ...defaults.settings.segments, ...saved.settings?.segments },
      subtitleStyle: normalizeSubtitleStyle(saved.settings?.subtitleStyle),
    },
    scoped: Object.fromEntries(
      Object.entries(saved.scoped ?? {}).map(([k, v]) => [k, v.subtitleStyle ? { ...v, subtitleStyle: normalizeSubtitleStyle(v.subtitleStyle) } : v]),
    ),
  };
}

let state: State = defaults;
let loaded = false;
let saveTimer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const SAVE_DELAY = 1000;

/** The server refuses bodies longer than this (MAX_BYTES in apps/server/src/routes/data.ts, counted in characters). */
const MAX_SAVE_LENGTH = 512 * 1024;
/** Browsers drop keepalive requests (tab closing) with bodies over 64 KiB, counted in bytes. */
const KEEPALIVE_LENGTH = 64 * 1024 - 512;

/** Drop the older half of everything that's kept by recency: positions, history and per-show choices. */
function trimOldest(s: State): State | null {
  const half = <T,>(list: T[]) => list.slice(Math.floor(list.length / 2));
  const progress = Object.entries(s.progress);
  const scoped = Object.entries(s.scoped ?? {});
  if (progress.length < 2 && s.history.length < 2 && scoped.length < 2) return null;
  return {
    ...s,
    // Oldest first (re-inserted on use); history is newest first.
    progress: Object.fromEntries(half(progress)),
    scoped: Object.fromEntries(half(scoped)),
    history: s.history.slice(0, Math.ceil(s.history.length / 2)),
  };
}

/** The request body, trimming old entries until it fits under the server's limit (null when it can't). */
function saveBody(): string | null {
  let body = JSON.stringify({ data: state });
  while (body.length > MAX_SAVE_LENGTH) {
    const trimmed = trimOldest(state);
    if (!trimmed) return null;
    state = trimmed;
    emit();
    body = JSON.stringify({ data: state });
  }
  return body;
}

const tooMuch = () =>
  toast.error("Couldn't save to your account", { id: "save-too-large", description: "Watch later or hidden channels have grown too large. Remove some and changes will sync again." });

async function save() {
  saveTimer = undefined;
  if (window.fanoosDesktop?.offline) { window.fanoosDesktop.downloads?.saveState(state); return; }
  const body = saveBody();
  if (body === null) return tooMuch();
  try {
    const res = await fetch("/api/me/data", { method: "PUT", headers: { "content-type": "application/json" }, body, credentials: "same-origin" });
    if (!res.ok) throw new RequestError(res.status, await res.json().catch(() => ({ error: res.statusText })));
    window.fanoosDesktop?.downloads?.saveState(state);
  } catch (error) {
    // Refused for its size (a stricter server): trim old entries and try again, while there are any.
    if (error instanceof RequestError && error.code === "too_large") {
      const trimmed = trimOldest(state);
      if (!trimmed) return tooMuch();
      state = trimmed;
      emit();
      saveTimer = window.setTimeout(save, 0);
      return;
    }
    // Signed out or otherwise refused: retrying the same request won't help.
    if (error instanceof RequestError && error.status < 500 && error.status !== 408 && error.status !== 429) return;
    // Offline or a server hiccup: try again shortly.
    saveTimer = window.setTimeout(save, 10_000);
  }
}

function set(update: (current: State) => State) {
  const next = update(state);
  if (Object.is(next, state)) return;
  state = next;
  emit();
  if (!loaded) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, SAVE_DELAY);
}

// Send a pending save while the tab is still alive (switching away, or the first step of closing).
addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || saveTimer === undefined || !loaded) return;
  window.clearTimeout(saveTimer);
  void save();
});

// Don't lose a pending save when the tab closes.
addEventListener("pagehide", () => {
  if (saveTimer === undefined || !loaded) return;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (window.fanoosDesktop?.offline) { window.fanoosDesktop.downloads?.saveState(state); return; }
  const body = saveBody();
  if (body === null) return;
  void fetch("/api/me/data", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
    // Past the keepalive limit the browser would refuse it outright; a plain request may still finish.
    keepalive: new TextEncoder().encode(body).length <= KEEPALIVE_LENGTH,
    credentials: "same-origin",
  });
});

/** Load the account's data after sign-in. On first use, adopts what this browser had. */
export async function loadAppData() {
  const { data } = await api<{ data: Partial<State> | null }>("/me/data");
  let legacy: Partial<State> | null = null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    legacy = raw ? (JSON.parse(raw) as Partial<State>) : null;
  } catch {}
  const offline = await window.fanoosDesktop?.downloads?.state().catch(() => null);
  const pending = offline?.dirty ? offline.data as Partial<State> | null : null;
  const merged = pending ? {
    ...(data ?? legacy),
    progress: mergeOfflineProgress(data?.progress ?? {}, offline?.pendingProgress ?? {}),
    history: [...new Map([...(data?.history ?? []), ...Object.values(offline?.pendingHistory ?? {})].map((h) => [h.id, h])).values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
  } : data ?? legacy;
  state = normalize(merged);
  loaded = true;
  emit();
  if (pending) replayProgress(offline?.pendingProgress ?? {});
  if (pending || (!data && legacy)) await save();
  else window.fanoosDesktop?.downloads?.saveState(state);
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
}

/**
 * Services that keep their own watch progress (Plex, Crunchyroll) didn't hear about offline
 * playback; tell them now. Core ignores backends without progress tracking.
 */
function replayProgress(pending: Record<string, number | null>) {
  for (const [key, position] of Object.entries(pending).slice(0, 50)) {
    if (position === null) continue;
    const slash = key.indexOf("/");
    if (slash < 0) continue;
    void api("/actions/progress", { body: { backend: key.slice(0, slash), videoId: key.slice(slash + 1), position } }).catch(() => {});
  }
}

/** The bundled desktop player reads the same preferences and saves positions locally. */
export async function loadOfflineAppData() {
  const saved = await window.fanoosDesktop?.downloads?.state().catch(() => null);
  state = normalize(saved?.data as Partial<State> | null);
  loaded = true;
  emit();
}

/** Forget the previous account's data in memory (on sign-out). */
export function clearAppData() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  loaded = false;
  state = defaults;
  emit();
}

export const isAppDataLoaded = () => loaded;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Current state, for code outside React render (e.g. initial values). */
export const getLocalState = () => state;

export function useStore<T>(select: (state: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export const useSettings = () => useStore((s) => s.settings);

export const actions = {
  setting<K extends keyof Settings>(key: K, value: Settings[K]) {
    set((s) => Object.is(s.settings[key], value) ? s : ({ ...s, settings: { ...s.settings, [key]: value } }));
  },
  segment(category: SegmentCategory, action: SegmentAction) {
    set((s) => ({ ...s, settings: { ...s.settings, segments: { ...s.settings.segments, [category]: action } } }));
  },
  toggleWatchLater(id: string) {
    set((s) => ({
      ...s,
      watchLater: s.watchLater.includes(id) ? s.watchLater.filter((v) => v !== id) : [id, ...s.watchLater],
    }));
  },
  watched(id: string) {
    set((s) =>
      s.settings.keepHistory
        ? { ...s, history: [{ id, at: new Date().toISOString() }, ...s.history.filter((h) => h.id !== id)].slice(0, 200) }
        : s,
    );
  },
  clearHistory() {
    set((s) => ({ ...s, history: [], progress: {} }));
  },
  searched(query: string) {
    const q = query.trim();
    if (!q) return;
    set((s) => (s.settings.keepSearches ? { ...s, searches: [q, ...s.searches.filter((v) => v !== q)].slice(0, 8) } : s));
  },
  forgetSearch(query: string) {
    set((s) => ({ ...s, searches: s.searches.filter((v) => v !== query) }));
  },
  clearSearches() {
    set((s) => ({ ...s, searches: [] }));
  },
  toggleMute(channelId: string) {
    set((s) => ({
      ...s,
      muted: s.muted.includes(channelId) ? s.muted.filter((v) => v !== channelId) : [...s.muted, channelId],
    }));
  },
  /** Remember where playback stopped; finished videos drop out of "Continue watching". */
  saveProgress(id: string, seconds: number, duration: number) {
    set((s) => {
      if (!s.settings.keepHistory) return s;
      const progress = { ...s.progress };
      // Re-insert so key order tracks recency.
      delete progress[id];
      const position = resumePosition(seconds, duration);
      if (position !== undefined) progress[id] = position;
      // Keep the most recent 300 entries.
      const keys = Object.keys(progress);
      if (keys.length > 300) for (const key of keys.slice(0, keys.length - 300)) delete progress[key];
      return { ...s, progress };
    });
  },
  /** Drop a video's saved position (removes it from "Continue watching"). */
  forgetProgress(id?: string) {
    set((s) => {
      if (!id) return { ...s, progress: {} };
      const progress = { ...s.progress };
      delete progress[id];
      return { ...s, progress };
    });
  },
  /**
   * Remember a choice made while watching for the video's season, show or channel (playbackScopes).
   * It also becomes the starting point for places without their own choice yet.
   */
  trackPrefs(scopes: string[], update: TrackPrefs) {
    set((s) => {
      const { subtitleStyle, ...langs } = update;
      const map = { ...s.scoped };
      for (const scope of scopes) {
        const prev = map[scope];
        // Re-insert so key order tracks recency.
        delete map[scope];
        map[scope] = { ...prev, ...update };
      }
      const keys = Object.keys(map);
      if (keys.length > MAX_SCOPES) for (const key of keys.slice(0, keys.length - MAX_SCOPES)) delete map[key];
      return {
        ...s,
        scoped: map,
        languages: Object.keys(langs).length ? { ...s.languages, ...langs } : s.languages,
        settings: subtitleStyle ? { ...s.settings, subtitleStyle } : s.settings,
      };
    });
  },
  /** Reset history, positions, searches, Watch later and preferences for the account. */
  reset() {
    set(() => defaults);
  },
};

/** Track choices for a video, from its scopes (see playbackScopes). Stable while nothing changes. */
export function useTrackPrefs(scopes: string[]) {
  const key = scopes.join("|");
  const audio = useStore((s) => trackPrefs(s, key.split("|")).audio);
  const subtitles = useStore((s) => trackPrefs(s, key.split("|")).subtitles);
  const subtitleStyle = useStore((s) => trackPrefs(s, key.split("|")).subtitleStyle);
  return { audio, subtitles, subtitleStyle };
}

/** Saved position for an item key. */
export const useProgress = (key: string) => useStore((s) => s.progress[key]);
