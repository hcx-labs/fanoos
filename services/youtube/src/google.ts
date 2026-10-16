/*
 * Google OAuth (authorization code + PKCE) and the few YouTube Data API calls
 * that need identity: the subscription list, playlists, and video metadata.
 * Scope is youtube.readonly; refresh tokens are stored encrypted.
 */
import { createHash } from "node:crypto";
import { config } from "./config.ts";
import { decrypt, encrypt, randomToken } from "./crypto.ts";
import { db } from "./db.ts";

export const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/youtube.readonly"];
/** Needed for subscribing, rating and commenting. Requested only when the user opts in. */
export const WRITE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
export const canWrite = (scopes: string) => scopes.split(" ").includes(WRITE_SCOPE);

export function authorizationUrl(state: string, opts: { write?: boolean; loginHint?: string } = {}) {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: [...SCOPES, ...(opts.write ? [WRITE_SCOPE] : [])].join(" "),
    include_granted_scopes: "true",
    ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
    access_type: "offline",
    prompt: "consent select_account",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), verifier };
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope: string; id_token?: string; error?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok) throw Object.assign(new Error(body.error ?? `token ${res.status}`), { code: body.error });
  return body;
}

export const exchangeCode = (code: string, verifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.google.redirectUri });

export async function userInfo(accessToken: string) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`userinfo ${res.status}`);
  return (await res.json()) as { sub: string; email: string; name?: string; picture?: string };
}

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

export class RelinkRequired extends Error {}

/** A valid access token for a linked account, refreshing (and persisting) it if needed. */
export async function accessToken(accountId: string): Promise<string> {
  const row = db.prepare("SELECT refresh_token, access_token, access_expires FROM accounts WHERE ref = ?").get(accountId) as
    | { refresh_token: string | null; access_token: string | null; access_expires: number }
    | undefined;
  if (!row?.refresh_token) throw new RelinkRequired();
  if (row.access_token && row.access_expires > Date.now() + 60_000) return decrypt(row.access_token);
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(row.refresh_token) });
    db.prepare("UPDATE accounts SET access_token = ?, access_expires = ?, needs_relink = 0 WHERE ref = ?").run(
      encrypt(t.access_token),
      Date.now() + t.expires_in * 1000,
      accountId,
    );
    return t.access_token;
  } catch (error) {
    if ((error as { code?: string }).code === "invalid_grant") {
      db.prepare("UPDATE accounts SET needs_relink = 1 WHERE ref = ?").run(accountId);
      throw new RelinkRequired();
    }
    throw error;
  }
}

/** The project's daily Data API quota is used up. */
export class QuotaExceeded extends Error {}
/** The account hasn't granted the permission this action needs. */
export class WriteNotAllowed extends Error {}

async function dataApi<T>(
  accountId: string,
  path: string,
  params: Record<string, string>,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await accessToken(accountId);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  url.search = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) {
    db.prepare("UPDATE accounts SET access_expires = 0 WHERE ref = ?").run(accountId);
    throw new RelinkRequired();
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const text = await res.text();
    const reason = (JSON.parse(text || "{}") as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason ?? "";
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) throw new QuotaExceeded();
    if (res.status === 403 && /insufficientPermissions|forbidden|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason + text)) throw new WriteNotAllowed();
    const error = new Error(`YouTube Data API ${path}: ${res.status} ${reason || text.slice(0, 200)}`);
    throw Object.assign(error, { status: res.status, reason });
  }
  return (await res.json()) as T;
}

type Thumbs = { default?: { url: string }; medium?: { url: string }; high?: { url: string } };

/** Every channel the account subscribes to (paginated, 1 quota unit per 50). */
export async function fetchSubscriptions(accountId: string) {
  const out: { channelId: string; title: string; avatar?: string }[] = [];
  let pageToken = "";
  do {
    const page = await dataApi<{
      items: { snippet: { title: string; resourceId: { channelId: string }; thumbnails: Thumbs } }[];
      nextPageToken?: string;
    }>(accountId, "subscriptions", { part: "snippet", mine: "true", maxResults: "50", order: "alphabetical", ...(pageToken ? { pageToken } : {}) });
    for (const item of page.items) {
      out.push({ channelId: item.snippet.resourceId.channelId, title: item.snippet.title, avatar: item.snippet.thumbnails.default?.url });
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && out.length < 5000);
  return out;
}

export async function fetchPlaylists(accountId: string) {
  const page = await dataApi<{
    items: { id: string; snippet: { title: string; thumbnails: Thumbs }; contentDetails: { itemCount: number }; status: { privacyStatus: string } }[];
  }>(accountId, "playlists", { part: "snippet,contentDetails,status", mine: "true", maxResults: "50" });
  return page.items.map((p) => ({
    id: p.id,
    title: p.snippet.title,
    count: p.contentDetails.itemCount,
    thumbnail: p.snippet.thumbnails.medium?.url ?? p.snippet.thumbnails.default?.url,
    private: p.status.privacyStatus !== "public",
  }));
}

/** ISO 8601 duration (PT1H2M3S) to seconds. */
export function isoDuration(value: string) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(value);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export type VideoStats = { duration: number; views: number; likes?: number; live: boolean; upcoming: boolean; category?: string };

/** YouTube's video categories, with shorter labels for filter chips. */
const categories: Record<string, string> = {
  "1": "Film & Animation", "2": "Autos", "10": "Music", "15": "Animals", "17": "Sports", "19": "Travel",
  "20": "Gaming", "22": "Vlogs", "23": "Comedy", "24": "Entertainment", "25": "News", "26": "How-to & Style",
  "27": "Education", "28": "Science & Tech", "29": "Activism", "30": "Movies", "43": "Shows",
};

/** Public Data API call with the server's API key (no user identity, no user quota). */
async function publicDataApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  url.search = new URLSearchParams({ ...params, key: config.youtubeApiKey }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`YouTube Data API ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/**
 * Duration, views, live state and category for up to 50 videos per call (1 quota unit).
 * Uses the server's API key when set, otherwise the given linked account.
 */
export async function fetchVideoStats(accountId: string | null, ids: string[]): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  type Page = {
    items: {
      id: string;
      snippet: { liveBroadcastContent: string; categoryId?: string };
      contentDetails: { duration: string };
      statistics: { viewCount?: string; likeCount?: string };
    }[];
  };
  for (let i = 0; i < ids.length; i += 50) {
    const params = { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: "50" };
    let page: Page;
    if (config.youtubeApiKey) page = await publicDataApi<Page>("videos", params);
    else if (accountId) page = await dataApi<Page>(accountId, "videos", params);
    else return out;
    for (const v of page.items) {
      out.set(v.id, {
        duration: isoDuration(v.contentDetails.duration),
        views: Number(v.statistics.viewCount ?? 0),
        likes: v.statistics.likeCount ? Number(v.statistics.likeCount) : undefined,
        live: v.snippet.liveBroadcastContent === "live",
        upcoming: v.snippet.liveBroadcastContent === "upcoming",
        category: v.snippet.categoryId ? categories[v.snippet.categoryId] : undefined,
      });
    }
  }
  return out;
}

// Writes (need WRITE_SCOPE). Each costs 50 quota units.

export async function subscribe(accountId: string, channelId: string) {
  const res = await dataApi<{ snippet: { title: string; thumbnails: Thumbs } }>(
    accountId,
    "subscriptions",
    { part: "snippet" },
    { method: "POST", body: { snippet: { resourceId: { kind: "youtube#channel", channelId } } } },
  );
  return { title: res.snippet.title, avatar: res.snippet.thumbnails.default?.url };
}

export async function unsubscribe(accountId: string, channelId: string) {
  const found = await dataApi<{ items: { id: string }[] }>(accountId, "subscriptions", { part: "id", mine: "true", forChannelId: channelId });
  for (const item of found.items) await dataApi(accountId, "subscriptions", { id: item.id }, { method: "DELETE" });
}

export type Rating = "like" | "dislike" | "none";

export async function rate(accountId: string, videoId: string, rating: Rating) {
  await dataApi(accountId, "videos/rate", { id: videoId, rating }, { method: "POST" });
}

export async function getRating(accountId: string, videoId: string): Promise<Rating> {
  const res = await dataApi<{ items: { rating: string }[] }>(accountId, "videos/getRating", { id: videoId });
  const r = res.items[0]?.rating;
  return r === "like" || r === "dislike" ? r : "none";
}

type CommentSnippet = { authorDisplayName: string; authorProfileImageUrl?: string; textOriginal?: string; textDisplay: string; likeCount: number };

/** Posts a top-level comment, or a reply when parentId is given. Returns what was posted. */
export async function postComment(accountId: string, videoId: string, text: string, parentId?: string) {
  if (parentId) {
    const res = await dataApi<{ id: string; snippet: CommentSnippet }>(
      accountId,
      "comments",
      { part: "snippet" },
      { method: "POST", body: { snippet: { parentId, textOriginal: text } } },
    );
    return { id: res.id, snippet: res.snippet };
  }
  const res = await dataApi<{ snippet: { topLevelComment: { id: string; snippet: CommentSnippet } } }>(
    accountId,
    "commentThreads",
    { part: "snippet" },
    { method: "POST", body: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } } },
  );
  return { id: res.snippet.topLevelComment.id, snippet: res.snippet.topLevelComment.snippet };
}
