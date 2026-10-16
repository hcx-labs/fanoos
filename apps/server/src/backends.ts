/*
 * Fanoos core's side of the provider protocol (packages/shared/src/protocol.ts): a generic client
 * for every backend service. Nothing here knows about any particular provider.
 */
import type { BackendInfo } from "@tube/shared";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { fail } from "./http.ts";

export type BackendService = { slug: string; url: string };

export const services: BackendService[] = config.backends;

export const serviceBySlug = (slug: string) => services.find((s) => s.slug === slug);

/** Where the browser reaches a backend's /public routes (see the proxy in routes/proxy.ts). */
export const publicBase = (slug: string) => `/api/b/${slug}`;

/** Rewrite "/public/…" strings in a backend's JSON so the browser reaches them through core. */
function rewrite(value: unknown, slug: string): unknown {
  if (typeof value === "string") return value.startsWith("/public/") ? `${publicBase(slug)}${value}` : value;
  if (Array.isArray(value)) return value.map((v) => rewrite(v, slug));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, slug)]));
  return value;
}

export class BackendError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Call a backend's /v1 API. Errors keep the backend's status, message and code. */
export async function call<T>(
  slug: string,
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | undefined>; accounts?: string[]; timeoutMs?: number } = {},
): Promise<T> {
  const service = serviceBySlug(slug);
  if (!service) throw new BackendError(404, "No such backend.", "not_found");
  const url = new URL(`${service.url}/v1${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  if (opts.accounts) url.searchParams.set("accounts", opts.accounts.join(","));
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${config.backendToken}`,
        "x-fanoos-base": publicBase(slug),
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch {
    throw new BackendError(503, `The ${infoOf(slug)?.name ?? slug} backend isn't reachable. Is it running?`, "backend_down");
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const body = (data ?? {}) as { error?: string; code?: string };
    throw new BackendError(res.status, body.error ?? `Backend error ${res.status}.`, body.code);
  }
  return rewrite(data, slug) as T;
}

/** Turn a backend failure into this API's error response. */
export function relay(error: unknown): never {
  if (error instanceof BackendError) {
    const status = ([400, 401, 403, 404, 409, 422, 429, 501, 502, 503] as const).find((s) => s === error.status) ?? 502;
    throw fail(status === 401 ? 502 : status, error.message, error.code);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Backend info, kept fresh in the background (null while a backend is down).

const infos = new Map<string, BackendInfo | null>();

async function refreshInfo(service: BackendService) {
  try {
    const info = await call<BackendInfo>(service.slug, "/info", { timeoutMs: 5000 });
    if (info.protocol !== 1) throw new Error(`speaks protocol ${info.protocol}`);
    if (infos.get(service.slug) === null || !infos.has(service.slug)) console.log(`Backend ${service.slug}: ${info.name} at ${service.url}`);
    infos.set(service.slug, info);
  } catch (error) {
    if (infos.get(service.slug) !== null) console.warn(`Backend ${service.slug} unavailable (${service.url}): ${(error as Error).message}`);
    infos.set(service.slug, null);
  }
}

export const refreshInfos = () => Promise.all(services.map(refreshInfo));
export const infoOf = (slug: string) => infos.get(slug) ?? null;

void refreshInfos();
setInterval(() => void refreshInfos(), 30_000).unref();

// ---------------------------------------------------------------------------
// Accounts: core keeps the backend's ref; these map between the two.

export type CoreAccount = { id: string; slug: string; ref: string; inFeed: boolean };

/** The user's linked accounts that have a backend ref, optionally only those in the feed. */
export function accountsFor(userId: string, opts: { feed?: boolean; slug?: string } = {}): CoreAccount[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.ref, a.in_feed, b.slug FROM accounts a JOIN backends b ON b.id = a.backend_id
       WHERE a.user_id = ? AND a.ref IS NOT NULL AND a.needs_relink = 0 ORDER BY a.created_at`,
    )
    .all(userId) as { id: string; ref: string; in_feed: number; slug: string }[];
  return rows
    .map((r) => ({ id: r.id, ref: r.ref, slug: r.slug, inFeed: Boolean(r.in_feed) }))
    .filter((a) => (!opts.feed || a.inFeed) && (!opts.slug || a.slug === opts.slug) && serviceBySlug(a.slug));
}

/** Group accounts by backend. */
export function bySlug(accounts: CoreAccount[]): Map<string, CoreAccount[]> {
  const map = new Map<string, CoreAccount[]>();
  for (const a of accounts) map.set(a.slug, [...(map.get(a.slug) ?? []), a]);
  return map;
}

/** Map `via` (backend refs) on items back to core account ids. */
export function viaToIds<T extends { via?: string[] }>(items: T[], accounts: CoreAccount[], slug: string): (T & { backend: string })[] {
  const ids = new Map(accounts.map((a) => [a.ref, a.id]));
  return items.map((item) => ({ ...item, backend: slug, via: item.via?.map((ref) => ids.get(ref)).filter((id): id is string => Boolean(id)) }));
}

/** One of the user's accounts, resolved to its backend and ref. */
export function accountById(userId: string, accountId: unknown): CoreAccount {
  if (typeof accountId !== "string") throw fail(400, "Choose an account.");
  const row = db
    .prepare("SELECT a.id, a.ref, a.in_feed, a.needs_relink, b.slug FROM accounts a JOIN backends b ON b.id = a.backend_id WHERE a.id = ? AND a.user_id = ?")
    .get(accountId, userId) as { id: string; ref: string | null; in_feed: number; needs_relink: number; slug: string } | undefined;
  if (!row) throw fail(404, "Account not found.");
  if (!row.ref || row.needs_relink) throw fail(409, "This account needs to be linked again.", "relink");
  return { id: row.id, ref: row.ref, slug: row.slug, inFeed: Boolean(row.in_feed) };
}

/** A backend said an account must be linked again: remember it so the app can ask. */
export function noteRelink(accountId: string, error: unknown) {
  if (error instanceof BackendError && error.code === "relink") db.prepare("UPDATE accounts SET needs_relink = 1 WHERE id = ?").run(accountId);
}
