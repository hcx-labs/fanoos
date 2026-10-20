/*
 * Types shared by the web app and the server. Types only: the server runs
 * TypeScript directly on Node, which can't strip types inside node_modules,
 * so this package must never contain runtime code.
 */

export type SegmentCategory =
  | "sponsor"
  | "selfpromo"
  | "interaction"
  | "intro"
  | "outro"
  | "preview"
  | "filler"
  | "music_offtopic";

export type Segment = { start: number; end: number; category: SegmentCategory };

export type Chapter = { start: number; title: string };

export * from "./protocol.ts";
import type { BackendInfo } from "./protocol.ts";

/** The service a backend talks to. Open-ended: any backend speaking the provider protocol can join. */
export type ProviderKind = "youtube" | "crunchyroll" | (string & {});

/** The viewer's own app account. */
export type Profile = {
  id: string;
  name: string;
  email: string;
  hasPassword: boolean;
  passkeys: number;
  /** The server's owner (its first account): manages server-wide settings. */
  owner: boolean;
};

/** Signed-in playback for age-restricted videos (server-wide, owner only). */
export type AgeRestrictedSetup =
  | { status: "off" }
  | { status: "starting" }
  /** `external`: shown by the instance in its own container (Docker), which signs in on its own once approved. */
  | { status: "waiting"; code: string; url: string; external?: boolean }
  /** `external`: it runs as its own service (Docker), not started by the backend. */
  | { status: "ready"; external?: boolean }
  /** Runs as its own service (Docker) and isn't answering yet: start it there. */
  | { status: "external"; url: string }
  | { status: "error"; error: string };

/**
 * A backend service the profile uses: one per provider (YouTube, Crunchyroll…). Fanoos core talks
 * to every backend through the same provider protocol (protocol.ts).
 */
export type Backend = {
  id: string;
  /** Short name used in app URLs, e.g. "youtube" in /watch/youtube/<id>. */
  slug: string;
  kind: ProviderKind;
  label: string;
  url: string;
  local: boolean;
  /** What the backend says it can do; null while it can't be reached. */
  info: BackendInfo | null;
};

/** A service account (e.g. a Google account) linked to the profile through a backend. */
export type LinkedAccount = {
  id: string;
  backendId: string;
  provider: ProviderKind;
  /** The viewer's nickname for this account, e.g. "Personal". */
  label: string;
  name: string;
  email: string;
  avatar?: string;
  /** Include this account's subscriptions in the merged feed. */
  inFeed: boolean;
  /** Set when the token was revoked or expired and the account must be linked again. */
  needsRelink?: boolean;
  /** Allowed to act as the account (subscribe, rate, comment, edit a watchlist). */
  canWrite: boolean;
  /** Plan or tier the service reports, e.g. "Premium". */
  plan?: string;
};

/** Everything the app needs at startup. */
export type Me = {
  profile: Profile;
  backends: Backend[];
  accounts: LinkedAccount[];
  defaultAccountId: string | null;
};

/**
 * Linked-account ids an item reached the viewer through, and the backend it came from
 * (both set by Fanoos core when merging; backends leave them out or use account refs).
 */
type Via = { via?: string[]; backend?: string };

/** Something to follow: a YouTube channel, or a show (series) on a streaming service. */
export type Channel = Via & {
  id: string;
  /** Optional provider URL for IDs that need server context. */
  url?: string;
  provider: ProviderKind;
  /** "series" for shows with seasons and episodes. Defaults to "channel". */
  kind?: "channel" | "series" | "movie" | "library";
  libraryType?: "movies" | "shows";
  year?: number;
  /** Portrait key art (shows). */
  poster?: string;
  name: string;
  handle?: string;
  avatar?: string;
  banner?: string;
  subscribers?: number;
  description?: string;
  /** The viewer's own grouping (Tech, Music…), stored per profile. */
  group?: string;
  verified?: boolean;
  /** New uploads or episodes in the last 48 hours. */
  unseen: number;
  /** A public feed (RSS/Atom) for following without an account. */
  feedUrl?: string;
  videoCount?: number;
  live?: boolean;
};

/** Season and episode details for episodic content. */
export type EpisodeInfo = {
  seriesId: string;
  seriesTitle: string;
  seasonId?: string;
  seasonTitle?: string;
  season?: number;
  /** As the service labels it ("12", "SP"). */
  number?: string;
  /** Audio language of this version, BCP 47 ("ja-JP"). */
  audio?: string;
  /** The same episode in other languages: each is its own playable id. */
  versions?: { audio: string; id: string; original?: boolean }[];
  subtitles?: string[];
  nextId?: string;
};

/** Anything playable: a YouTube video or an episode. */
export type Video = Via & {
  id: string;
  kind?: "video" | "movie" | "episode";
  year?: number;
  poster?: string;
  /** Owning library, when provided by a media-server backend. */
  libraryId?: string;
  /** Optional provider URL for IDs that need server context. */
  url?: string;
  provider: ProviderKind;
  title: string;
  /** Community title from DeArrow, when one exists. */
  altTitle?: string;
  channelId: string;
  channelName: string;
  channelAvatar?: string;
  channelVerified?: boolean;
  /** Seconds; 0 when unknown (e.g. upcoming or live). */
  duration: number;
  views: number;
  /** True when YouTube only gave a rounded figure ("13M"); show it rounded, not as fake precision. */
  viewsApprox?: boolean;
  /** ISO timestamp. */
  published: string;
  addedAt?: string;
  description: string;
  thumbnail: string;
  live?: boolean;
  upcoming?: boolean;
  /** YouTube's category, e.g. "Gaming" (feed videos). */
  category?: string;
  /** Seconds watched (from the service when it tracks progress itself). */
  progress?: number;
  episode?: EpisodeInfo;
  /** Needs a paid plan on the service. */
  premium?: boolean;
  /** Mature rating label from the service, e.g. "16+". */
  rating?: string;
  // Detail-only fields.
  likes?: number;
  /** Estimated by Return YouTube Dislike. */
  dislikes?: number;
  chapters?: Chapter[];
  segments?: Segment[];
  commentCount?: number;
};

export type Subtitle = {
  /** Distinguishes tracks sharing a language, such as manual and automatic captions. */
  id?: string;
  autoGenerated?: boolean;
  /** BCP 47 ("en-US"). */
  locale: string;
  label: string;
  url: string;
  /** "ass" needs a styled renderer; "vtt" plays natively. */
  format: "ass" | "vtt";
  /** Embedded track rendered by the provider during transcoding. */
  render?: "server";
};

export type PlaybackSource = {
  id: string;
  label: string;
  kind: "original" | "transcode";
  description?: string;
  height?: number;
  /** Target or source bitrate in bits per second. */
  bitrate?: number;
  mimeType?: string;
  stream: { dash?: string; progressive?: string; session?: { keepAlive?: string; release?: string; everySeconds?: number } };
};

export type Stream = {
  /** Explicit provider choices, e.g. original media versus server transcodes. */
  sources?: PlaybackSource[];
  defaultSource?: string;
  audioTracks?: { id: string; label: string; locale: string; selected?: boolean; sources: PlaybackSource[] }[];
  /** DASH manifest URL (adaptive, all qualities). */
  dash?: string;
  /** Encrypted streams: licence server URLs per DRM system, called by the browser's own CDM. */
  drm?: { widevine?: string; playready?: string };
  subtitles?: Subtitle[];
  /** Playback session kept by the service (stream limits): ping while playing, end when done. */
  session?: { keepAlive?: string; release?: string; everySeconds?: number };
  /** HLS manifest URL (live streams). */
  hls?: string;
  /** A single progressive file, when the service offers one. */
  progressive?: string;
  /** Set when the video can't be played here, with the reason. */
  /** `starting`: the service is warming up (e.g. after a restart); worth retrying in a few seconds. */
  /** `bot_check`: YouTube wants this server to sign in ("confirm you're not a bot"). */
  unavailable?: { code: "age_restricted" | "live" | "unplayable" | "starting" | "bot_check"; reason: string };
};

export type VideoDetail = { video: Video; channel: Channel; next: Video[]; stream: Stream };

/** Full channel description, loaded separately from the abbreviated browse metadata. */
export type ChannelAbout = { description: string };

/** A channel or show page. Shows split into sections (seasons); channels usually have none. */
export type ChannelPage = {
  channel: Channel;
  /** Nested channels, such as shows inside a media-server TV library. */
  channels?: Channel[];
  videos: Video[];
  /** Opaque cursor for the next batch in this channel/section. Absent at the end. */
  next?: string;
  sections?: { id: string; label: string; count?: number }[];
  /** The section `videos` belong to. */
  section?: string;
};

export type Comment = {
  id: string;
  author: string;
  avatar?: string;
  text: string;
  likes: number;
  /** As the service reports it, e.g. "2 days ago". */
  publishedText: string;
  pinned?: boolean;
  hearted?: boolean;
  byCreator?: boolean;
  replyCount: number;
  /** Opaque token to load replies. */
  replies?: string;
};

export type CommentPage = { comments: Comment[]; count?: number; next?: string };

export type CommentSort = "top" | "new";

export type Playlist = Via & {
  id: string;
  accountId: string;
  title: string;
  count: number;
  thumbnail?: string;
  private: boolean;
};

export type SearchFilters = {
  type: "all" | "video" | "channel";
  duration: "any" | "short" | "medium" | "long";
  uploaded: "any" | "today" | "week" | "month";
  sort: "relevance" | "date" | "views";
};

export type SearchResults = { channels: Channel[]; videos: Video[]; next?: string };

/** Error body for every non-2xx API response. */
export type ApiError = { error: string; code?: string };

/**
 * Watch time the player reports to core, about every 30 seconds of playback and when it stops.
 * `seconds` is real time spent watching; `media` is how much of the video played (more than
 * `seconds` when sped up); `skipped` is segments skipped automatically.
 */
export type WatchBeat = {
  /** Item key, "<backend>/<id>". */
  key: string;
  title: string;
  kind: "video" | "episode";
  channelId: string;
  channelName: string;
  category?: string;
  thumbnail?: string;
  duration: number;
  seconds: number;
  media: number;
  skipped: number;
  /** Played to the end (or within the last few percent). */
  finished?: boolean;
  /** The viewer's IANA time zone, so days and hours are their own. */
  tz: string;
};

/** Totals for a period, also returned for the period before it for comparison. */
export type WatchTotals = {
  seconds: number;
  media: number;
  skipped: number;
  items: number;
  finished: number;
  channels: number;
  activeDays: number;
};

export type WatchStatsChannel = {
  /** "<backend>:<channel id>", as in channel groups. */
  key: string;
  backend: string;
  id: string;
  name: string;
  kind: "video" | "episode";
  thumbnail?: string;
  seconds: number;
  items: number;
  finished: number;
  /** Average share of each item watched, 0–1. */
  completion: number;
  lastAt: number;
};

export type WatchStatsItem = {
  key: string;
  backend: string;
  id: string;
  title: string;
  channelName: string;
  thumbnail?: string;
  duration: number;
  seconds: number;
  /** Video time played in the period, over its length: 2 means watched twice. */
  plays: number;
};

export type WatchStats = {
  /** Period length in days; 0 for all time. */
  days: number;
  /** First and last day of the period (the viewer's local dates, YYYY-MM-DD). */
  from: string;
  to: string;
  totals: WatchTotals;
  /** The same totals for the period just before (absent for all time). */
  previous?: WatchTotals;
  /** One entry per day in the period (all time: from the first day watched). */
  daily: { day: string; seconds: number; byBackend: Record<string, number> }[];
  /** Seconds by weekday (0 = Sunday) and hour of day. */
  heatmap: number[][];
  backends: { backend: string; seconds: number; items: number }[];
  channels: WatchStatsChannel[];
  items: WatchStatsItem[];
  categories: { name: string; seconds: number }[];
  /** Longest single day in the period. */
  topDay?: { day: string; seconds: number };
  /** Most episodes of one show finished in a single day. */
  binge?: { day: string; name: string; key: string; episodes: number };
  streak: { current: number; longest: number };
  /** When tracking started (ms), for "since …". */
  since?: number;
};

export type * from "./downloads.ts";
