import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { config } from "./config.ts";

export const db = new DatabaseSync(join(config.dataDir, "tube.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  default_account_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS backends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  local INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  backend_id TEXT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar TEXT,
  google_sub TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  access_expires INTEGER NOT NULL DEFAULT 0,
  in_feed INTEGER NOT NULL DEFAULT 1,
  needs_relink INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, google_sub)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  avatar TEXT,
  PRIMARY KEY (account_id, channel_id)
);
CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_groups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  grp TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
`);

// Housekeeping: drop expired sessions and pending challenges.
export function sweep() {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM pending WHERE expires_at < ?").run(now);
}

/** Short-lived server-side state (passkey challenges, OAuth state). */
export const pending = {
  put(kind: string, id: string, data: unknown, ttlMs = 10 * 60_000) {
    db.prepare("INSERT OR REPLACE INTO pending (id, kind, data, expires_at) VALUES (?, ?, ?, ?)").run(id, kind, JSON.stringify(data), Date.now() + ttlMs);
  },
  /** Read and delete (single use). */
  take<T>(kind: string, id: string): T | null {
    const row = db.prepare("SELECT data, expires_at FROM pending WHERE id = ? AND kind = ?").get(id, kind) as { data: string; expires_at: number } | undefined;
    db.prepare("DELETE FROM pending WHERE id = ?").run(id);
    return row && row.expires_at > Date.now() ? (JSON.parse(row.data) as T) : null;
  },
};
