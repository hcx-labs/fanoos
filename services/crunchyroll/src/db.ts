import { openDatabase } from "../../kit/src/db.ts";
import { config } from "./config.ts";

/**
 * Crunchyroll accounts linked through this backend. `ref` is the opaque handle Fanoos core keeps;
 * the refresh token (and the device id it's bound to) never leave this service.
 */
export const { db, pending } = openDatabase(
  config.dataDir,
  "crunchyroll.sqlite",
  `
CREATE TABLE IF NOT EXISTS accounts (
  ref TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  profile_id TEXT,
  external_id TEXT,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  plan TEXT,
  refresh_token TEXT,
  needs_relink INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`,
);
