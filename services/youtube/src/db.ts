import { openDatabase } from "../../kit/src/db.ts";
import { config } from "./config.ts";

/**
 * Google accounts linked through this backend. `ref` is the opaque handle Fanoos core keeps;
 * tokens never leave this service.
 */
export const { db, pending } = openDatabase(
  config.dataDir,
  "youtube.sqlite",
  `
CREATE TABLE IF NOT EXISTS accounts (
  ref TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar TEXT,
  refresh_token TEXT,
  access_token TEXT,
  access_expires INTEGER NOT NULL DEFAULT 0,
  scopes TEXT NOT NULL DEFAULT '',
  needs_relink INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  account_ref TEXT NOT NULL REFERENCES accounts(ref) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  avatar TEXT,
  PRIMARY KEY (account_ref, channel_id)
);
`,
);
