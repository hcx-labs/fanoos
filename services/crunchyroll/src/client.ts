/*
 * Talking to Crunchyroll as its Android TV app.
 *
 * Uses node:https rather than fetch: Crunchyroll's Cloudflare challenges undici, whose
 * browser-style sec-fetch-* headers don't match a TV client. Only the headers given here are sent.
 */
import { request } from "node:https";
import type { IncomingMessage } from "node:http";
import { fail } from "../../kit/src/service.ts";
import { config } from "./config.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { db } from "./db.ts";

export const API = "https://www.crunchyroll.com";
export const userAgent = `Crunchyroll/ANDROIDTV/${config.appVersion} (Android 12; en-US; SHIELD Android TV Build/SR1A.211012.001)`;

export type Raw = { status: number; headers: IncomingMessage["headers"]; body: Buffer };

/** One HTTPS request with exactly these headers. */
export function send(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer; timeoutMs?: number } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const body = opts.body;
    const req = request(
      url,
      {
        method: opts.method ?? "GET",
        headers: { "user-agent": userAgent, ...opts.headers, ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(opts.timeoutMs ?? 20_000, () => req.destroy(new Error("timeout")));
    req.end(body);
  });
}

/** Stream a response (segments) instead of buffering it. */
export function stream(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { "user-agent": userAgent, ...headers }, signal }, resolve);
    req.on("error", reject);
    req.end();
  });
}

const json = <T>(raw: Raw): T => JSON.parse(raw.body.toString("utf8") || "null") as T;

export class CrunchyrollError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Authentication

const basic = () => ({ authorization: `Basic ${config.basicAuth}` });

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; account_id?: string; profile_id?: string; country?: string };

/** Start the TV activation flow: a short code the user enters at crunchyroll.com/activate. */
export async function deviceCode(deviceId: string) {
  const raw = await send(`${API}/auth/v1/device/code`, {
    method: "POST",
    headers: { ...basic(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ device_id: deviceId, device_type: "Fanoos", device_name: "Fanoos" }).toString(),
  });
  if (raw.status !== 200) throw new CrunchyrollError(raw.status, `device code ${raw.status}`);
  return json<{ user_code: string; device_code: string; interval: number; expires_in: number }>(raw);
}

/** Poll the activation: null while the user hasn't entered the code yet. */
export async function deviceToken(deviceCode: string): Promise<TokenResponse | null> {
  const raw = await send(`${API}/auth/v1/device/token`, {
    method: "POST",
    headers: { ...basic(), "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });
  if (raw.status === 204 || raw.status >= 500) return null;
  if (raw.status !== 200) throw new CrunchyrollError(raw.status, `device token ${raw.status}`);
  return json<TokenResponse>(raw);
}

async function refresh(refreshToken: string, deviceId: string): Promise<TokenResponse> {
  const raw = await send(`${API}/auth/v1/token`, {
    method: "POST",
    headers: { ...basic(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "offline_access",
      device_id: deviceId,
      device_type: "Fanoos",
      device_name: "Fanoos",
    }).toString(),
  });
  if (raw.status === 400 || raw.status === 401) throw new CrunchyrollError(raw.status, "invalid_grant");
  if (raw.status !== 200) throw new CrunchyrollError(raw.status, `token refresh ${raw.status}`);
  return json<TokenResponse>(raw);
}

/** Access tokens last five minutes; keep them in memory only. */
const access = new Map<string, { token: string; expires: number; accountId: string }>();
const refreshing = new Map<string, Promise<{ token: string; accountId: string }>>();

export type AccountAuth = { token: string; accountId: string };

/** A valid access token for a linked account (refreshing it, and persisting a rotated refresh token). */
export function auth(ref: string): Promise<AccountAuth> {
  const hit = access.get(ref);
  if (hit && hit.expires > Date.now() + 30_000) return Promise.resolve(hit);
  const running = refreshing.get(ref);
  if (running) return running;
  const work = (async () => {
    const row = db.prepare("SELECT account_id, device_id, refresh_token, needs_relink FROM accounts WHERE ref = ?").get(ref) as
      | { account_id: string; device_id: string; refresh_token: string | null; needs_relink: number }
      | undefined;
    if (!row) throw fail(404, "Account not found.", "not_found");
    if (!row.refresh_token || row.needs_relink) throw fail(409, "This Crunchyroll account needs to be linked again.", "relink");
    try {
      const t = await refresh(decrypt(row.refresh_token), row.device_id);
      if (t.refresh_token && t.refresh_token !== decrypt(row.refresh_token)) {
        db.prepare("UPDATE accounts SET refresh_token = ? WHERE ref = ?").run(encrypt(t.refresh_token), ref);
      }
      const entry = { token: t.access_token, expires: Date.now() + t.expires_in * 1000, accountId: row.account_id };
      access.set(ref, entry);
      return entry;
    } catch (error) {
      if (error instanceof CrunchyrollError && error.message === "invalid_grant") {
        db.prepare("UPDATE accounts SET needs_relink = 1 WHERE ref = ?").run(ref);
        throw fail(409, "This Crunchyroll account needs to be linked again.", "relink");
      }
      throw error;
    }
  })().finally(() => refreshing.delete(ref));
  refreshing.set(ref, work);
  return work;
}

/** First-time token, straight from activation (before an account row exists). */
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** JSON from the Crunchyroll API as a linked account. `{account}` in the path becomes its account id. */
export async function api<T>(ref: string, path: string, opts: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const a = await auth(ref);
  const url = new URL(path.replace("{account}", a.accountId), API);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  if (!url.searchParams.has("locale") && url.pathname.startsWith("/content/")) url.searchParams.set("locale", config.locale);
  const raw = await send(url.toString(), {
    method: opts.method,
    headers: { ...bearer(a.token), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (raw.status === 401) {
    access.delete(ref);
    throw new CrunchyrollError(401, `${path}: unauthorized`);
  }
  if (raw.status >= 400) throw new CrunchyrollError(raw.status, `${url.pathname}: ${raw.status} ${raw.body.toString("utf8").slice(0, 200)}`);
  return (raw.status === 204 || !raw.body.length ? undefined : json<T>(raw)) as T;
}

/** Public JSON (no account), e.g. skip events. */
export async function publicJson<T>(url: string): Promise<T | null> {
  const raw = await send(url, { timeoutMs: 8000 }).catch(() => null);
  if (!raw || raw.status !== 200) return null;
  try {
    return json<T>(raw);
  } catch {
    return null;
  }
}
