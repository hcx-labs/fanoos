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

/** Services that can back a linked account. Only YouTube today. */
export type ProviderKind = "youtube";

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
  | { status: "waiting"; code: string; url: string }
  | { status: "ready" }
  | { status: "error"; error: string };

/** A server that talks to a service for the profile. Each profile starts with "This server". */
export type Backend = { id: string; kind: ProviderKind; label: string; url: string; local: boolean };

/** A service account (e.g. a Google account) linked to the profile through a backend. */
export type LinkedAccount = {
  id: string;
  backendId: string;
  /** The viewer's nickname for this account, e.g. "Personal". */
  label: string;
  name: string;
  email: string;
  avatar?: string;
  /** Include this account's subscriptions in the merged feed. */
  inFeed: boolean;
  /** Set when the token was revoked or expired and the account must be linked again. */
  needsRelink?: boolean;
};

/** Everything the app needs at startup. */
export type Me = {
  profile: Profile;
  backends: Backend[];
  accounts: LinkedAccount[];
  defaultAccountId: string | null;
  /** Whether the server has Google OAuth configured (linking is impossible without it). */
  googleConfigured: boolean;
};

/** Linked-account ids an item reached the viewer through (set when merging). */
type Via = { via?: string[] };

export type Channel = Via & {
  id: string;
  provider: ProviderKind;
  name: string;
  handle?: string;
  avatar?: string;
  banner?: string;
  subscribers?: number;
  description?: string;
  /** The viewer's own grouping (Tech, Music…), stored per profile. */
  group?: string;
  verified?: boolean;
  /** Uploads in the last 48 hours. */
  unseen: number;
  videoCount?: number;
  live?: boolean;
};

export type Video = Via & {
  id: string;
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
  /** ISO timestamp. */
  published: string;
  description: string;
  thumbnail: string;
  live?: boolean;
  upcoming?: boolean;
  /** Seconds watched, tracked on the device. */
  progress?: number;
  // Detail-only fields.
  likes?: number;
  /** Estimated by Return YouTube Dislike. */
  dislikes?: number;
  chapters?: Chapter[];
  segments?: Segment[];
  commentCount?: number;
};

export type Stream = {
  /** DASH manifest URL (adaptive, all qualities). */
  dash?: string;
  /** HLS manifest URL (live streams). */
  hls?: string;
  /** A single progressive file, when the service offers one. */
  progressive?: string;
  /** Set when the video can't be played here, with the reason. */
  unavailable?: { code: "age_restricted" | "live" | "unplayable"; reason: string };
};

export type VideoDetail = { video: Video; channel: Channel; next: Video[]; stream: Stream };

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

export type Playlist = {
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
