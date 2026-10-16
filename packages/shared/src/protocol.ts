/*
 * The provider protocol: how Fanoos core talks to backend services (YouTube, Crunchyroll, …).
 * Types only. Every backend serves the same HTTP API, so core and the web app never need
 * provider-specific code; a new service joins by implementing this.
 *
 * Transport: JSON over HTTP, all routes under /v1 (core → backend) and /public (browser →
 * backend, through core's /api/b/<slug>/ proxy).
 *
 * Every /v1 request carries `Authorization: Bearer <backend token>` (shared secret between core
 * and the backend). Core also sends `X-Fanoos-Base: /api/b/<slug>` on every request, /public ones
 * included: the prefix under which the browser reaches the backend.
 *
 * Browser-facing URLs (images, manifests, licences): inside JSON, backends write them as paths
 * starting with "/public/", and core rewrites every such string to "/api/b/<slug>/public/…".
 * In other bodies (DASH manifests), backends prefix them with X-Fanoos-Base themselves.
 *
 * Accounts: a backend keeps its own credentials for every account linked through it and gives
 * core an opaque `ref`. Content routes take the refs to act for in `accounts=ref1,ref2` (merged
 * results list the refs each item came through in `via`); actions take a single `account`.
 *
 *   GET    /v1/info                              BackendInfo
 *   POST   /v1/links            LinkRequest      LinkStart        (begin linking an account)
 *   GET    /v1/links/:flow                       LinkStatus       (poll until linked)
 *   GET    /v1/accounts/:ref                     ProviderAccount
 *   DELETE /v1/accounts/:ref                     revoke at the service and forget
 *   POST   /v1/accounts/import  AccountImport    ProviderAccount  (optional: adopt credentials)
 *   GET    /v1/following?accounts=&refresh=1     Channel[]        (subscriptions, watchlist)
 *   GET    /v1/feed?accounts=&limit=             Video[]          newest first
 *   GET    /v1/continue?accounts=                Video[]          with progress (if tracked)
 *   GET    /v1/search?q=&type=&duration=&uploaded=&sort=   SearchResults
 *   GET    /v1/videos/:id?accounts=              VideoDetail
 *   GET    /v1/videos?ids=&accounts=             Video[]
 *   GET    /v1/videos/:id/comments?sort=&next=   CommentPage
 *   GET    /v1/comments/replies?token=           CommentPage
 *   GET    /v1/channels/:id?section=&accounts=   ChannelPage
 *   GET    /v1/channels/:id/followers?accounts=  string[] (refs following it)
 *   GET    /v1/playlists?accounts=               Playlist[]
 *   GET    /v1/resolve?url=                      ResolvedLink     (a pasted link)
 *   POST   /v1/actions/follow   { account, channelId, on }
 *   GET    /v1/actions/rating?account=&video=    { rating }
 *   POST   /v1/actions/rating   { account, videoId, rating }
 *   POST   /v1/actions/comments { account, videoId, text, parentId? }   Comment
 *   POST   /v1/actions/progress { account, videoId, position }
 *   *      /v1/admin/*                           backend-specific owner settings (core checks owner)
 *
 * Errors: non-2xx with ApiError. Codes core understands: "relink" (the account must be linked
 * again), "read_only", "quota", "not_found", "unsupported", "upstream".
 */
import type { Channel, ProviderKind } from "./index.ts";

export type ProtocolVersion = 1;

/** Optional abilities; core and the web app show only what a backend offers. */
export type BackendFeature =
  /** New items from what accounts follow. */
  | "feed"
  | "search"
  | "comments"
  /** Like/dislike as an account. */
  | "ratings"
  /** Follow and unfollow as an account. */
  | "follow"
  /** The service tracks watch progress itself (core reports positions to it). */
  | "progress"
  | "playlists"
  /** Community dislike counts. */
  | "dislikes"
  /** Skippable segments (sponsors, intros, credits). */
  | "segments"
  /** Community titles (DeArrow). */
  | "titles";

export type BackendInfo = {
  protocol: ProtocolVersion;
  kind: ProviderKind;
  /** The service's name, e.g. "YouTube". */
  name: string;
  /** Brand colour for small marks, as a CSS colour. */
  color: string;
  /** How the service names things, for labels ("channel"/"show", "subscribe"/"add to watchlist"). */
  nouns: {
    channel: string;
    channels: string;
    video: string;
    videos: string;
    follow: string;
    following: string;
  };
  link: {
    /** "redirect": sign in on the service's page; "device": enter a code on the service's site. */
    method: "redirect" | "device";
    /** False when the backend lacks the credentials it needs to link accounts. */
    configured: boolean;
    /** Shown before linking: what the backend can and can't do with the account. */
    can: string[];
    cannot: string[];
    /** An optional extra permission (e.g. acting as the account), asked for only when chosen. */
    writeOption?: { label: string; description: string; can: string[] };
    /** Requirements, e.g. "Needs a Premium membership". */
    requirement?: string;
  };
  features: BackendFeature[];
  /** Hostnames whose links this backend opens (pasted into search). */
  linkHosts: string[];
  /** Links to items on the service itself ("{id}" is replaced), for "Open on …". */
  urls: { video: string; channel: string };
  /** Whether watching is anonymous to the service (true), or tied to a linked account (false). */
  private: boolean;
  /** Owner-only settings panels the backend offers under /v1/admin (e.g. "age-restricted"). */
  admin?: string[];
};

/** An account as a backend reports it. `ref` is the backend's opaque handle. */
export type ProviderAccount = {
  ref: string;
  name: string;
  email?: string;
  avatar?: string;
  canWrite: boolean;
  plan?: string;
  needsRelink?: boolean;
};

export type LinkRequest = {
  /** Where the browser returns after a redirect flow (core's completion URL). */
  returnUrl: string;
  /** Also ask for permission to act as the account. */
  write?: boolean;
  /** Re-link or upgrade this existing account. */
  account?: string;
};

export type LinkStart =
  | { flow: string; kind: "redirect"; url: string }
  | { flow: string; kind: "device"; code: string; verifyUrl: string; expiresIn: number; interval: number };

export type LinkStatus =
  | { status: "pending" }
  | { status: "linked"; account: ProviderAccount; write?: boolean }
  | { status: "failed"; error: string; code?: string };

/** Credentials handed over from another store (migrations). Shape is backend-specific. */
export type AccountImport = { credentials: Record<string, unknown> };

export type ResolvedLink = { type: "video"; id: string; start?: number } | { type: "channel"; id: string };

/** A followed channel or show, with the account refs following it. */
export type Followed = Channel & { via: string[] };
