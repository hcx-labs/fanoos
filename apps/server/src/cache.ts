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
