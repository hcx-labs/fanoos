/*
 * App data saved to the signed-in Fanoos account: preferences, watch history,
 * playback positions, Watch later, recent searches and hidden channels. Loaded when
 * the session starts (session.ts) and saved back shortly after each change, so every
 * device signed in to the account shares it. Only the theme stays per-browser (theme.tsx).
 */
import { useSyncExternalStore } from "react";
import { api } from "./api";
import { storageKey } from "./brand";
import { defaultSubtitleStyle, normalizeSubtitleStyle, type SubtitleStyle } from "./subtitle-style";
import type { SegmentCategory } from "./types";

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
  /** Preferred audio and subtitle languages for episodes ("ja-JP", "en-US"; "" = off). */
  languages?: { audio?: string; subtitles?: string };
};

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
  };
}

let state: State = defaults;
let loaded = false;
let saveTimer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const SAVE_DELAY = 1000;

async function save() {
  saveTimer = undefined;
  try {
    await api("/me/data", { method: "PUT", body: { data: state } });
  } catch {
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

// Don't lose a pending save when the tab closes.
addEventListener("pagehide", () => {
  if (saveTimer === undefined || !loaded) return;
  window.clearTimeout(saveTimer);
  void fetch("/api/me/data", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: state }),
    keepalive: true,
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
  state = normalize(data ?? legacy);
  loaded = true;
  emit();
  if (!data && legacy) await save();
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
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
      if (seconds >= 10 && !(duration && seconds > duration - 20)) progress[id] = Math.floor(seconds);
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
  languages(update: { audio?: string; subtitles?: string }) {
    set((s) => ({ ...s, languages: { ...s.languages, ...update } }));
  },
  /** Reset history, positions, searches, Watch later and preferences for the account. */
  reset() {
    set(() => defaults);
  },
};

/** Saved position for an item key. */
export const useProgress = (key: string) => useStore((s) => s.progress[key]);
