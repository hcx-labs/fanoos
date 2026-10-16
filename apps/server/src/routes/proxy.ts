/*
 * The browser reaches backends' /public routes (images, manifests, segments, licences, OAuth
 * callbacks) only through here: /api/b/<slug>/public/… → <backend>/public/…. Backends protect
 * those routes with signed URLs; core adds the viewer's session check and X-Fanoos-Base.
 */
import { Hono } from "hono";
import { publicBase, serviceBySlug } from "../backends.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";

export const proxyRoutes = new Hono<AppEnv>();
proxyRoutes.use("*", requireUser);

const forwardRequest = ["range", "content-type", "if-none-match", "if-modified-since"];
const forwardResponse = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified", "location"];

proxyRoutes.all("/:slug/public/*", async (c) => {
  const slug = c.req.param("slug");
  const service = serviceBySlug(slug);
  if (!service) throw fail(404, "No such backend.", "not_found");
  const incoming = new URL(c.req.url);
  const path = incoming.pathname.slice(`${publicBase(slug)}`.length);
  const headers: Record<string, string> = { "x-fanoos-base": publicBase(slug) };
  for (const name of forwardRequest) {
    const value = c.req.header(name);
    if (value) headers[name] = value;
  }
  const method = c.req.method;
  let upstream: Response;
  try {
    upstream = await fetch(`${service.url}${path}${incoming.search}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer(),
      redirect: "manual",
      signal: c.req.raw.signal,
    });
  } catch {
    throw fail(503, "That backend isn't reachable.", "backend_down");
  }
  const out = new Headers();
  for (const name of forwardResponse) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
});
