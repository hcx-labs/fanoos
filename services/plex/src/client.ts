import { createHash } from "node:crypto";
import { SharedCache } from "../../kit/src/cache.ts";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { decrypt } from "./crypto.ts";
import { fail } from "../../kit/src/service.ts";
import type { PlexContainer, Resource, Server } from "./types.ts";
export type AccountRow = { ref: string; user_id: string; client_id: string; name: string; email?: string; token: string; needs_relink: number };
export function account(ref: string, allowRelink = false): AccountRow {
 const row = db.prepare("SELECT * FROM accounts WHERE ref = ?").get(ref) as AccountRow | undefined;
 if (!row) throw fail(404, "Plex account not found.", "not_found");
 if (row.needs_relink && !allowRelink) throw fail(409, "Reconnect your Plex account.", "relink");
 return row;
}
export function headers(clientId: string, token?: string): Record<string, string> {
 return { accept: "application/json", "X-Plex-Product": "Fanoos", "X-Plex-Version": "1.0", "X-Plex-Client-Identifier": clientId, "X-Plex-Platform": "Chrome", "X-Plex-Device": "Web", ...(token ? { "X-Plex-Token": token } : {}) };
}
export async function cloud<T>(path: string, clientId: string, token?: string, init: RequestInit = {}): Promise<T> {
 const res = await fetch(`https://plex.tv${path}`, { ...init, headers: { ...headers(clientId, token), ...init.headers }, redirect: "error", signal: AbortSignal.timeout(15_000) });
 if (res.status === 401) throw fail(409, "Reconnect your Plex account.", "relink");
 if (!res.ok) throw fail(502, `Plex sign-in is unavailable (${res.status}).`, "upstream");
 return await res.json() as T;
}
const cache = new Map<string, { until: number; value: Promise<Server[]> }>();
export function forgetServers(ref: string) { cache.delete(ref); }
export function servers(ref: string): Promise<Server[]> {
 const row = account(ref);
 const old = cache.get(ref); if (old && old.until > Date.now()) return old.value;
 const value = (async () => {
  let resources: Resource[];
  try { resources = await cloud<Resource[]>("/api/v2/resources?includeHttps=1&includeRelay=1", row.client_id, decrypt(row.token)); }
  catch (error) { if ((error as { message?: string }).message?.includes("Reconnect")) db.prepare("UPDATE accounts SET needs_relink = 1 WHERE ref = ?").run(ref); throw error; }
  const found = await Promise.all(resources.filter((r) => r.provides.split(",").includes("server") && r.accessToken && (!config.onlyOwned || r.owned)).map(async (r) => {
   const connections = [...r.connections].filter((c) => {
    try { const u = new URL(c.uri); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash; } catch { return false; }
   }).sort((a, b) => Number(b.local) - Number(a.local) || Number(b.uri.startsWith("https:")) - Number(a.uri.startsWith("https:")) || Number(a.relay) - Number(b.relay));
   for (const connection of connections) {
    try {
     const res = await fetch(new URL("/identity", connection.uri), { headers: headers(row.client_id, r.accessToken), redirect: "error", signal: AbortSignal.timeout(2500) });
     if (!res.ok) continue;
     const data = await res.json() as PlexContainer;
     if (data.MediaContainer.machineIdentifier !== r.clientIdentifier) continue;
     return { id: r.clientIdentifier, name: r.name, url: new URL(connection.uri).origin, token: r.accessToken!, clientId: row.client_id };
    } catch { /* Try the next advertised Plex connection; never disable TLS verification. */ }
   }
   return null;
  }));
  return found.filter((s): s is Server => s !== null);
 })();
 cache.set(ref, { value, until: Date.now() + 60_000 });
 void value.catch(() => cache.delete(ref));
 return value;
}
export async function serverFor(ref: string, id: string): Promise<Server> {
 const server = (await servers(ref)).find((s) => s.id === id);
 if (!server) throw fail(503, "This Plex server is offline or is not reachable from the Fanoos backend.", "upstream");
 return server;
}
export async function request(server: Server, resource: string, init: RequestInit = {}): Promise<Response> {
 const url = new URL(resource, server.url);
 if (url.origin !== server.url || !resource.startsWith("/") || resource.startsWith("//")) throw fail(403, "Invalid Plex resource.");
 return fetch(url, { ...init, headers: { ...headers(server.clientId, server.token), ...init.headers }, redirect: "error", signal: init.signal ?? AbortSignal.timeout(30_000) });
}
async function fetchJson(server: Server, path: string): Promise<PlexContainer> {
 const res = await request(server, path);
 if (res.status === 401 || res.status === 403) throw fail(403, "Plex denied access to this library. Check the server's sharing permissions.");
 if (res.status === 404) throw fail(404, "This item is no longer in your Plex library.", "not_found");
 if (!res.ok) throw fail(502, `Plex could not load this library (${res.status}).`, "upstream");
 return await res.json() as PlexContainer;
}

// Reuse the same Redis-backed stale-while-revalidate cache as YouTube/Crunchyroll.
// Server access tokens scope private libraries; raw credentials never become Redis keys.
const libraryCache = new SharedCache<PlexContainer>("libraries-v1", { ttlSeconds: 120, staleSeconds: 300 });
const metadataCache = new SharedCache<PlexContainer>("metadata-v1", { ttlSeconds: 300, staleSeconds: 600 });
const browseCache = new SharedCache<PlexContainer>("browse-v1", { ttlSeconds: 60, staleSeconds: 120 });
export async function json(server: Server, path: string, options: { fresh?: boolean } = {}): Promise<PlexContainer> {
 if (options.fresh || path.startsWith("/library/onDeck")) return fetchJson(server, path);
 const key = createHash("sha256").update(JSON.stringify([server.id, server.clientId, server.token, path])).digest("hex");
 const cache = path === "/library/sections" ? libraryCache : /^\/library\/metadata\/\d+(\?|$)/.test(path) ? metadataCache : browseCache;
 return cache.get(key, () => fetchJson(server, path));
}
