import { Hono } from "hono";
import { call, infoOf, relay, serviceBySlug } from "../backends.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";
import { isOwner } from "../users.ts";

/** Server-wide settings, for the server's owner only: each backend's own admin panels (/v1/admin/*). */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireUser, async (c, next) => {
  if (!isOwner(c.get("user").id)) throw fail(403, "Only the server's owner can change this.", "not_owner");
  await next();
});

adminRoutes.all("/b/:slug/*", async (c) => {
  const slug = c.req.param("slug");
  if (!serviceBySlug(slug)) throw fail(404, "No such backend.", "not_found");
  const path = new URL(c.req.url).pathname.split(`/admin/b/${slug}`)[1] ?? "";
  const panel = path.split("/")[1] ?? "";
  if (!infoOf(slug)?.admin?.includes(panel)) throw fail(404, "That backend has no such setting.", "not_found");
  const body = c.req.method === "GET" ? undefined : await c.req.json().catch(() => ({}));
  return c.json(await call(slug, `/admin${path}`, { method: c.req.method, body }).catch(relay));
});
