import type { Backend, LinkedAccount, Me } from "@tube/shared";
import { infoOf, services } from "./backends.ts";
import { config } from "./config.ts";
import { randomId } from "./crypto.ts";
import { db } from "./db.ts";
import type { User } from "./http.ts";

type AccountRow = {
  id: string;
  backend_id: string;
  label: string;
  name: string;
  email: string;
  avatar: string | null;
  in_feed: number;
  needs_relink: number;
  can_write: number;
  provider: string;
  plan: string | null;
};

/** Every profile has one backend row per configured service (it holds the profile's label for it). */
export function ensureBackends(userId: string) {
  for (const s of services) {
    const exists = db.prepare("SELECT id FROM backends WHERE user_id = ? AND slug = ?").get(userId, s.slug);
    if (!exists) {
      db.prepare("INSERT INTO backends (id, user_id, kind, label, url, local, slug) VALUES (?, ?, ?, 'This server', ?, 1, ?)").run(
        randomId(),
        userId,
        infoOf(s.slug)?.kind ?? s.slug,
        config.publicUrl.origin,
        s.slug,
      );
    }
  }
}

export function createUser(name: string, email: string, passwordHash: string | null): string {
  const id = randomId();
  db.prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, email, passwordHash, Date.now());
  ensureBackends(id);
  return id;
}

/** The server's owner is its first account. */
export const isOwner = (userId: string) =>
  (db.prepare("SELECT id FROM users ORDER BY created_at, rowid LIMIT 1").get() as { id: string } | undefined)?.id === userId;

export const findUserByEmail = (email: string) =>
  db.prepare("SELECT id, name, email, password_hash, default_account_id FROM users WHERE email = ?").get(email) as User | undefined;

export function backendsOf(userId: string): Backend[] {
  ensureBackends(userId);
  const order = new Map(services.map((s, i) => [s.slug, i]));
  return (
    db.prepare("SELECT id, kind, label, url, local, slug FROM backends WHERE user_id = ?").all(userId) as {
      id: string;
      kind: string;
      label: string;
      url: string;
      local: number;
      slug: string;
    }[]
  )
    .filter((b) => order.has(b.slug))
    .sort((a, b) => order.get(a.slug)! - order.get(b.slug)!)
    .map((b) => {
      const info = infoOf(b.slug);
      return { id: b.id, slug: b.slug, kind: info?.kind ?? b.kind, label: b.label, url: b.url, local: Boolean(b.local), info };
    });
}

export function accountsOf(userId: string): LinkedAccount[] {
  return (
    db
      .prepare(
        `SELECT a.id, a.backend_id, a.label, a.name, a.email, a.avatar, a.in_feed, a.needs_relink, a.can_write, a.provider, a.plan
         FROM accounts a JOIN backends b ON b.id = a.backend_id WHERE a.user_id = ? AND a.ref IS NOT NULL ORDER BY a.created_at`,
      )
      .all(userId) as AccountRow[]
  ).map((a) => ({
    id: a.id,
    backendId: a.backend_id,
    provider: a.provider,
    label: a.label,
    name: a.name,
    email: a.email,
    avatar: a.avatar ?? undefined,
    inFeed: Boolean(a.in_feed),
    needsRelink: Boolean(a.needs_relink) || undefined,
    canWrite: Boolean(a.can_write),
    plan: a.plan ?? undefined,
  }));
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
  };
}
