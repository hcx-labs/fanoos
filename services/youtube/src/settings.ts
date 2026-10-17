/** Server-wide settings the owner changes in the app (stored in this backend's database). */
import { db } from "./db.ts";

export type Settings = {
  /**
   * When YouTube answers "Sign in to confirm you're not a bot" to the anonymous companion, play
   * that video through the signed-in one instead. Off by default: it ties those plays to the
   * signed-in Google account, which otherwise only ever plays age-restricted videos.
   */
  botCheckFallback: boolean;
};

const defaults: Settings = { botCheckFallback: false };

export function getSettings(): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return { ...defaults, ...Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) };
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
}
