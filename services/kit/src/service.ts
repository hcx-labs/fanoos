/*
 * The provider-protocol server every backend service is built on (see packages/shared/src/protocol.ts).
 * A service supplies its BackendInfo and registers routes on `v1` (core → backend, token-checked)
 * and `pub` (browser → backend through core's /api/b/<slug>/ proxy, protected by signed URLs).
 */
import { timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { BackendInfo } from "@tube/shared";
import { initCache } from "./cache.ts";
import type { ServiceConfig } from "./env.ts";

type Status = 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 501 | 502 | 503;

/** A protocol error: core understands the codes in protocol.ts and passes the message on. */
export const fail = (status: Status, error: string, code?: string) =>
  new HTTPException(status, { res: Response.json({ error, code }, { status }) });

export type ServiceEnv = {
  Variables: {
    /** Prefix under which the browser reaches this service (its /public routes follow it), e.g. "/api/b/youtube". */
    base: string;
    /** Account refs to act for (`accounts=` query). */
    accounts: string[];
  };
};

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createService(config: ServiceConfig, info: () => BackendInfo) {
  if (!config.token) throw new Error("Set BACKEND_TOKEN (shared with Fanoos core) in this service's .env.");
  initCache({ redisUrl: config.redisUrl, ttlSeconds: config.cacheTtlSeconds, staleSeconds: config.cacheStaleSeconds, prefix: `fanoos:${config.name}` });

  const app = new Hono<ServiceEnv>();
  const v1 = new Hono<ServiceEnv>();
  const pub = new Hono<ServiceEnv>();

  // X-Fanoos-Base: where the browser reaches /public (core sends it on every request).
  const readBase = (c: Context<ServiceEnv>) => {
    const base = c.req.header("x-fanoos-base") ?? "";
    if (base && !/^\/[\w/-]*$/.test(base)) throw fail(400, "Bad X-Fanoos-Base.");
    c.set("base", base.replace(/\/$/, ""));
  };
  v1.use("*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    if (!equal(auth, `Bearer ${config.token}`)) throw fail(401, "Bad backend token.", "unauthorized");
    readBase(c);
    c.set("accounts", (c.req.query("accounts") ?? "").split(",").filter(Boolean));
    await next();
  });
  pub.use("*", async (c, next) => {
    readBase(c);
    await next();
  });
  v1.get("/info", (c) => c.json(info()));

  app.get("/health", (c) => c.json({ ok: true, service: config.name }));
  app.notFound((c) => c.json({ error: "Not found.", code: "not_found" }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.json({ error: "Something went wrong in the backend.", code: "upstream" }, 500);
  });

  return {
    app,
    v1,
    pub,
    /** Mount the routes (Hono copies a sub-app's routes when it's mounted, so this comes last) and listen. */
    start() {
      app.route("/v1", v1);
      app.route("/public", pub);
      serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, ({ port }) =>
        console.log(`${info().name} backend on http://127.0.0.1:${port}  (protocol v${info().protocol})`),
      );
    },
  };
}

/** The single account an action is for (`account` in the query or JSON body). */
export function accountParam(c: Context, body?: { account?: unknown }): string {
  const ref = body?.account ?? c.req.query("account");
  if (typeof ref !== "string" || !ref) throw fail(400, "Choose an account.");
  return ref;
}
