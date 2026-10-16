import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

/** The service's own SQLite database (accounts and credentials live here, not in core). */
export function openDatabase(dataDir: string, file: string, schema: string) {
  const db = new DatabaseSync(join(dataDir, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(schema);
  db.exec(`CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL)`);

  /** Short-lived state for linking flows. */
  const pending = {
    put(kind: string, id: string, data: unknown, ttlMs = 10 * 60_000) {
      db.prepare("INSERT OR REPLACE INTO pending (id, kind, data, expires_at) VALUES (?, ?, ?, ?)").run(id, kind, JSON.stringify(data), Date.now() + ttlMs);
    },
    get<T>(kind: string, id: string): T | null {
      const row = db.prepare("SELECT data, expires_at FROM pending WHERE id = ? AND kind = ?").get(id, kind) as { data: string; expires_at: number } | undefined;
      return row && row.expires_at > Date.now() ? (JSON.parse(row.data) as T) : null;
    },
    delete(id: string) {
      db.prepare("DELETE FROM pending WHERE id = ?").run(id);
    },
  };
  setInterval(() => db.prepare("DELETE FROM pending WHERE expires_at < ?").run(Date.now()), 10 * 60_000).unref();
  return { db, pending };
}
