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

export function authorizationUrl(state: string) {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
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
  const row = db.prepare("SELECT refresh_token, access_token, access_expires FROM accounts WHERE id = ?").get(accountId) as
    | { refresh_token: string | null; access_token: string | null; access_expires: number }
    | undefined;
  if (!row?.refresh_token) throw new RelinkRequired();
  if (row.access_token && row.access_expires > Date.now() + 60_000) return decrypt(row.access_token);
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(row.refresh_token) });
    db.prepare("UPDATE accounts SET access_token = ?, access_expires = ?, needs_relink = 0 WHERE id = ?").run(
      encrypt(t.access_token),
      Date.now() + t.expires_in * 1000,
      accountId,
    );
    return t.access_token;
  } catch (error) {
    if ((error as { code?: string }).code === "invalid_grant") {
      db.prepare("UPDATE accounts SET needs_relink = 1 WHERE id = ?").run(accountId);
      throw new RelinkRequired();
    }
    throw error;
  }
}

async function dataApi<T>(accountId: string, path: string, params: Record<string, string>): Promise<T> {
  const token = await accessToken(accountId);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  url.search = new URLSearchParams(params).toString();
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    db.prepare("UPDATE accounts SET access_expires = 0 WHERE id = ?").run(accountId);
    throw new RelinkRequired();
  }
  if (!res.ok) throw new Error(`YouTube Data API ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
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

export type VideoStats = { duration: number; views: number; likes?: number; live: boolean; upcoming: boolean };

/** Duration, views and live state for up to 50 videos per call (1 quota unit). */
export async function fetchVideoStats(accountId: string, ids: string[]): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  for (let i = 0; i < ids.length; i += 50) {
    const page = await dataApi<{
      items: { id: string; snippet: { liveBroadcastContent: string }; contentDetails: { duration: string }; statistics: { viewCount?: string; likeCount?: string } }[];
    }>(accountId, "videos", { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: "50" });
    for (const v of page.items) {
      out.set(v.id, {
        duration: isoDuration(v.contentDetails.duration),
        views: Number(v.statistics.viewCount ?? 0),
        likes: v.statistics.likeCount ? Number(v.statistics.likeCount) : undefined,
        live: v.snippet.liveBroadcastContent === "live",
        upcoming: v.snippet.liveBroadcastContent === "upcoming",
      });
    }
  }
  return out;
}
