import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "./config.ts";
import { sweep } from "./db.ts";
import { type AppEnv, sameOrigin } from "./http.ts";
import { scheduleMigration } from "./migrate.ts";
import { webApp } from "./web.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { adminRoutes } from "./routes/admin.ts";
import { dataRoutes } from "./routes/data.ts";
import { authRoutes } from "./routes/auth.ts";
import { oidcRoutes } from "./routes/oidc.ts";
import { contentRoutes } from "./routes/content.ts";
import { proxyRoutes } from "./routes/proxy.ts";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", sameOrigin);
app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth/oidc", oidcRoutes);
app.route("/auth", authRoutes);
app.route("/b", proxyRoutes);
app.route("/admin", adminRoutes);
app.route("/me/data", dataRoutes);
app.route("/", accountRoutes);
app.route("/", contentRoutes);

app.notFound((c) => c.json({ error: "Not found." }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

setInterval(sweep, 10 * 60_000).unref();
// Accounts linked before backends were separate services move to their backend.
scheduleMigration();

// In production (WEB_ROOT set) the same server also serves the built web app.
const site = config.webRoot ? new Hono().get("*", webApp(config.webRoot)) : null;
const fetch = (request: Request, env: unknown) =>
  site && !new URL(request.url).pathname.startsWith("/api/") ? site.fetch(request, env) : app.fetch(request, env);

serve({ fetch, port: config.port, hostname: config.host }, ({ port }) => {
  console.log(`API on http://${config.host}:${port}/api  (app origin ${config.publicUrl.origin})${site ? `; web app from ${config.webRoot}` : ""}`);
  console.log(`Backends: ${config.backends.map((b) => `${b.slug} (${b.url})`).join(", ") || "none"}`);
  if (!config.backendToken) console.warn("BACKEND_TOKEN isn't set: backends will refuse every request.");
  if (config.oidc.enabled) console.log(`Sign-in: OIDC only (${config.oidc.name}, ${config.oidc.issuer}); password and passkey sign-in are disabled.`);
  if (config.oidc.enabled && (!config.oidc.clientId || !config.oidc.clientSecret)) {
    console.warn(`OIDC_ISSUER is set but OIDC_CLIENT_${config.oidc.clientId ? "SECRET" : "ID"} is empty: sign-in will fail at the provider.`);
  }
  if (config.oidc.enabled) console.log(`OIDC redirect URI to register with the provider: ${config.oidc.redirectUri}`);
});
