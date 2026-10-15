import type { Backend, LinkedAccount, Me } from "@tube/shared";
import { config } from "./config.ts";
import { randomId } from "./crypto.ts";
import { db } from "./db.ts";
import type { User } from "./http.ts";
import { proxyImage } from "./media.ts";

type AccountRow = {
  id: string;
  backend_id: string;
  label: string;
  name: string;
  email: string;
  avatar: string | null;
  in_feed: number;
  needs_relink: number;
};

export function createUser(name: string, email: string, passwordHash: string | null): string {
  const id = randomId();
  db.prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, email, passwordHash, Date.now());
  // Every profile starts with this server as its YouTube backend.
  db.prepare("INSERT INTO backends (id, user_id, kind, label, url, local) VALUES (?, ?, 'youtube', 'This server', ?, 1)").run(
    randomId(),
    id,
    config.publicUrl.origin,
  );
  return id;
}

/** The server's owner is its first account. */
export const isOwner = (userId: string) =>
  (db.prepare("SELECT id FROM users ORDER BY created_at, rowid LIMIT 1").get() as { id: string } | undefined)?.id === userId;

export const findUserByEmail = (email: string) =>
  db.prepare("SELECT id, name, email, password_hash, default_account_id FROM users WHERE email = ?").get(email) as User | undefined;

export function backendsOf(userId: string): Backend[] {
  return (db.prepare("SELECT id, kind, label, url, local FROM backends WHERE user_id = ? ORDER BY local DESC, label").all(userId) as {
    id: string;
    kind: "youtube";
    label: string;
    url: string;
    local: number;
  }[]).map((b) => ({ ...b, local: Boolean(b.local) }));
}

export function accountsOf(userId: string): LinkedAccount[] {
  return (db.prepare("SELECT id, backend_id, label, name, email, avatar, in_feed, needs_relink FROM accounts WHERE user_id = ? ORDER BY created_at").all(userId) as AccountRow[]).map(
    (a) => ({
      id: a.id,
      backendId: a.backend_id,
      label: a.label,
      name: a.name,
      email: a.email,
      avatar: a.avatar ? proxyImage(a.avatar) : undefined,
      inFeed: Boolean(a.in_feed),
      needsRelink: Boolean(a.needs_relink) || undefined,
    }),
  );
}

export function me(user: User): Me {
  const accounts = accountsOf(user.id);
  const passkeys = (db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").get(user.id) as { n: number }).n;
  const defaultAccountId = accounts.some((a) => a.id === user.default_account_id) ? user.default_account_id : (accounts[0]?.id ?? null);
  return {
    profile: { id: user.id, name: user.name, email: user.email, hasPassword: Boolean(user.password_hash), passkeys, owner: isOwner(user.id) },
    backends: backendsOf(user.id),
    accounts,
    defaultAccountId,
    googleConfigured: config.google.configured,
  };
}
