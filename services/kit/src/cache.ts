import { createClient } from "redis";

/** Small in-memory TTL cache that also de-duplicates concurrent loads of the same key. */
export class TtlCache<T> {
  private entries = new Map<string, { value: Promise<T>; expires: number }>();
  private ttlMs: number;
  private max: number;

  constructor(ttlMs: number, max = 2000) {
    this.ttlMs = ttlMs;
    this.max = max;
  }

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = load();
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    // Failed loads aren't cached.
    value.catch(() => this.entries.delete(key));
    if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  delete(key: string) {
    this.entries.delete(key);
  }
}

/** Run tasks with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await task(items[i]!);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Shared response cache: Redis when REDIS_URL is set (survives API restarts,
// bounded by Redis' maxmemory + LRU), otherwise a bounded in-memory map.
// Values must be JSON-serialisable.


type Store = {
  get(keys: string[]): Promise<(string | null)[]>;
  set(entries: [string, string][], ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
};

function memoryStore(max = 5000): Store {
  const map = new Map<string, { value: string; expires: number }>();
  return {
    async get(keys) {
      return keys.map((k) => {
        const hit = map.get(k);
        if (!hit || hit.expires < Date.now()) {
          map.delete(k);
          return null;
        }
        // Re-insert so iteration order tracks recency (oldest evicted first).
        map.delete(k);
        map.set(k, hit);
        return hit.value;
      });
    },
    async set(entries, ttl) {
      for (const [k, value] of entries) {
        map.delete(k);
        map.set(k, { value, expires: Date.now() + ttl * 1000 });
      }
      while (map.size > max) map.delete(map.keys().next().value!);
    },
    async del(key) {
      map.delete(key);
    },
  };
}

let store: Store = memoryStore();
let defaults = { ttlSeconds: 600, staleSeconds: 86_400, prefix: "fanoos" };

/**
 * Configure the shared cache once at startup: Redis when a URL is given, else memory.
 * `prefix` keeps each service's keys apart in a shared Redis.
 */
export function initCache(opts: { redisUrl?: string; ttlSeconds: number; staleSeconds: number; prefix: string }) {
  defaults = { ttlSeconds: opts.ttlSeconds, staleSeconds: opts.staleSeconds, prefix: opts.prefix };
  if (opts.redisUrl) connectRedis(opts.redisUrl);
}

function connectRedis(url: string) {
  const client = createClient({ url, socket: { reconnectStrategy: (n) => Math.min(n * 200, 5000) } });
  let warned = false;
  client.on("error", (error: Error) => {
    if (!warned) console.warn(`Redis unavailable (${error.message}); using the in-memory cache until it's back.`);
    warned = true;
  });
  client.on("ready", () => {
    warned = false;
    console.log("Cache: Redis connected");
  });
  const fallback = memoryStore();
  const ready = () => client.isReady;
  store = {
    async get(keys) {
      if (!ready()) return fallback.get(keys);
      try {
        return await client.mGet(keys);
      } catch {
        return fallback.get(keys);
      }
    },
    async set(entries, ttl) {
      if (!ready()) return fallback.set(entries, ttl);
      try {
        const multi = client.multi();
        for (const [k, v] of entries) multi.set(k, v, { EX: ttl });
        await multi.exec();
      } catch {
        await fallback.set(entries, ttl);
      }
    },
    async del(key) {
      await fallback.del(key);
      if (ready()) await client.del(key).catch(() => {});
    },
  };
  client.connect().catch(() => {});
}

/** A cached value and when it was stored, so stale entries can be served while refreshing. */
type Entry<T> = { v: T; t: number };

/**
 * Stale-while-revalidate cache. Entries are fresh for `ttl` seconds; after that,
 * for up to `stale` more seconds, the old value is returned immediately and a
 * single background refresh replaces it. Only a cold miss waits for the loader.
 * Failed loads are never cached, and a failed refresh keeps the old value.
 */
export class SharedCache<T> {
  private namespace: string;
  private ttl: number;
  private stale: number;
  private inflight = new Map<string, Promise<T>>();

  constructor(namespace: string, opts: { ttlSeconds?: number; staleSeconds?: number } = {}) {
    this.namespace = namespace;
    this.ttl = opts.ttlSeconds ?? defaults.ttlSeconds;
    this.stale = opts.staleSeconds ?? defaults.staleSeconds;
  }

  private key(key: string) {
    return `${defaults.prefix}:${this.namespace}:${key}`;
  }

  private isFresh(entry: Entry<T>) {
    return Date.now() - entry.t < this.ttl * 1000;
  }

  private write(entries: [string, T][]) {
    const now = Date.now();
    return store.set(
      entries.map(([k, v]) => [this.key(k), JSON.stringify({ v, t: now } satisfies Entry<T>)]),
      this.ttl + this.stale,
    );
  }

  /** Load once even when many callers ask at the same time. */
  private load(key: string, loader: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running;
    const loading = loader()
      .then(async (value) => {
        if (value !== undefined) await this.write([[key, value]]);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, loading);
    return loading;
  }

  /** Fresh value, or a stale one (refreshed in the background), or load it now on a miss. */
  async get(key: string, loader: () => Promise<T>): Promise<T> {
    const [hit] = await store.get([this.key(key)]);
    if (hit !== null && hit !== undefined) {
      const entry = JSON.parse(hit) as Entry<T>;
      if (!this.isFresh(entry)) {
        this.load(key, loader).catch((error: Error) => console.warn(`cache refresh failed (${this.namespace}):`, error.message));
      }
      return entry.v;
    }
    return this.load(key, loader);
  }

  /** Several values at once, plus which of them are stale (missing keys are absent). */
  async getMany(keys: string[]): Promise<{ values: Map<string, T>; stale: string[] }> {
    const values = new Map<string, T>();
    const stale: string[] = [];
    if (!keys.length) return { values, stale };
    const raw = await store.get(keys.map((k) => this.key(k)));
    raw.forEach((hit, i) => {
      if (hit === null || hit === undefined) return;
      const entry = JSON.parse(hit) as Entry<T>;
      values.set(keys[i]!, entry.v);
      if (!this.isFresh(entry)) stale.push(keys[i]!);
    });
    return { values, stale };
  }

  async setMany(entries: [string, T][]): Promise<void> {
    if (entries.length) await this.write(entries);
  }

  async delete(key: string): Promise<void> {
    await store.del(this.key(key));
  }
}
