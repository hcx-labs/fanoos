import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "./config.ts";
import { sweep } from "./db.ts";
import { type AppEnv, sameOrigin } from "./http.ts";
import { scheduleMigration } from "./migrate.ts";
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

serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, ({ port }) => {
  console.log(`API on http://127.0.0.1:${port}/api  (app origin ${config.publicUrl.origin})`);
  console.log(`Backends: ${config.backends.map((b) => `${b.slug} (${b.url})`).join(", ") || "none"}`);
  if (!config.backendToken) console.warn("BACKEND_TOKEN isn't set: backends will refuse every request.");
  if (config.oidc.enabled) console.log(`Sign-in: OIDC only (${config.oidc.name}, ${config.oidc.issuer}); password and passkey sign-in are disabled.`);
});
