import { openDatabase } from "../../kit/src/db.ts";
import { config } from "./config.ts";
export const { db, pending } = openDatabase(config.dataDir, "plex.sqlite", `
CREATE TABLE IF NOT EXISTS accounts (
 ref TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
 name TEXT NOT NULL, email TEXT, token TEXT NOT NULL, needs_relink INTEGER NOT NULL DEFAULT 0
);
`);
