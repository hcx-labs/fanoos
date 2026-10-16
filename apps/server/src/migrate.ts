/*
 * One-time migration: before backends were separate services, core kept Google tokens itself.
 * Hand each such account to the YouTube backend (which keeps credentials from now on), store the
 * ref it returns, and erase the tokens here. Retries until the backend is up.
 */
import type { ProviderAccount } from "@tube/shared";
import { call, serviceBySlug } from "./backends.ts";
import { decrypt } from "./crypto.ts";
import { db } from "./db.ts";

type Legacy = { id: string; google_sub: string; name: string; email: string; avatar: string | null; refresh_token: string; scopes: string; backend_id: string };

export async function migrateLegacyAccounts(): Promise<boolean> {
  const rows = db
    .prepare("SELECT id, google_sub, name, email, avatar, refresh_token, scopes, backend_id FROM accounts WHERE ref IS NULL AND refresh_token IS NOT NULL")
    .all() as Legacy[];
  if (!rows.length) return true;
  if (!serviceBySlug("youtube")) return true;
  for (const row of rows) {
    try {
      const account = await call<ProviderAccount>("youtube", "/accounts/import", {
        body: {
          credentials: { refreshToken: decrypt(row.refresh_token), sub: row.google_sub, name: row.name, email: row.email, avatar: row.avatar, scopes: row.scopes },
        },
      });
      db.prepare(
        "UPDATE accounts SET ref = ?, provider = 'youtube', can_write = ?, avatar = ?, refresh_token = NULL, access_token = NULL, google_sub = ? WHERE id = ?",
      ).run(account.ref, account.canWrite ? 1 : 0, account.avatar ?? null, `youtube:${account.ref}`, row.id);
      // Legacy rows point at the profile's original YouTube backend row, which now has slug "youtube".
      console.log(`Moved linked account ${row.email} to the YouTube backend.`);
    } catch (error) {
      console.warn(`Couldn't move ${row.email} to the YouTube backend yet: ${(error as Error).message}`);
      return false;
    }
  }
  return true;
}

export function scheduleMigration() {
  const attempt = async () => {
    if (!(await migrateLegacyAccounts())) setTimeout(attempt, 15_000).unref();
  };
  setTimeout(attempt, 2000).unref();
}
