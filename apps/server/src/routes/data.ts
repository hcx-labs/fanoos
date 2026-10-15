import { Hono } from "hono";
import { db } from "../db.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";

/**
 * The profile's app data: preferences, watch history, playback positions,
 * Watch later, recent searches and hidden channels. Stored as one JSON document
 * per profile so every device signed in to it sees the same state.
 */
export const dataRoutes = new Hono<AppEnv>();
dataRoutes.use("*", requireUser);

const MAX_BYTES = 512 * 1024;

dataRoutes.get("/", (c) => {
  const row = db.prepare("SELECT data, updated_at FROM user_data WHERE user_id = ?").get(c.get("user").id) as
    | { data: string; updated_at: number }
    | undefined;
  return c.json({ data: row ? JSON.parse(row.data) : null, updatedAt: row?.updated_at ?? 0 });
});

dataRoutes.put("/", async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BYTES) throw fail(422, "Too much data to save.", "too_large");
  let body: { data?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    throw fail(400, "Invalid JSON.");
  }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw fail(422, "Expected an object.");
  const now = Date.now();
  db.prepare("INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(
    c.get("user").id,
    JSON.stringify(body.data),
    now,
  );
  return c.json({ ok: true, updatedAt: now });
});

dataRoutes.delete("/", (c) => {
  db.prepare("DELETE FROM user_data WHERE user_id = ?").run(c.get("user").id);
  return c.json({ ok: true });
});
