import { randomBytes } from "node:crypto";
import { TtlCache } from "./cache.ts";
import { fail } from "../../kit/src/service.ts";

type Cursor<T> = { scope: string; load: () => Promise<T>; result?: Promise<T> };

/** Live YouTube.js pages cannot be serialized into Redis. Scope includes channel, query and sort. */
export class ChannelCursors<T> {
  private entries: TtlCache<Cursor<T>>;

  constructor(ttlMs = 30 * 60_000, max = 2000) {
    this.entries = new TtlCache(ttlMs, max);
  }

  async remember(scope: string, load: () => Promise<T>): Promise<string> {
    const token = randomBytes(18).toString("base64url");
    await this.entries.get(token, async () => ({ scope, load }));
    return token;
  }

  async next(scope: string, token: string): Promise<T> {
    const expired = () => fail(410, "This channel's video list expired. Reload it to continue.", "cursor_expired");
    if (!/^[\w-]{24}$/.test(token)) throw expired();
    const cursor = await this.entries.peek(token);
    if (!cursor || cursor.scope !== scope) throw expired();
    // Double clicks and retries return the same batch and next token, never skip a page.
    if (!cursor.result) {
      cursor.result = Promise.resolve().then(cursor.load).catch((error: unknown) => {
        cursor.result = undefined;
        throw error;
      });
    }
    return cursor.result;
  }
}
