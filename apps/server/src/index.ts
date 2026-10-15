import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "./config.ts";
import { sweep } from "./db.ts";
import { type AppEnv, sameOrigin } from "./http.ts";
import { mediaRoutes } from "./media.ts";
import { resumeSignedIn } from "./youtube/signed-in.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { adminRoutes } from "./routes/admin.ts";
import { dataRoutes } from "./routes/data.ts";
import { authRoutes } from "./routes/auth.ts";
import { contentRoutes } from "./routes/content.ts";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", sameOrigin);
app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", authRoutes);
app.route("/", mediaRoutes);
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
// Bring back signed-in playback for age-restricted videos if it was set up before.
resumeSignedIn();

serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, ({ port }) => {
  console.log(`API on http://127.0.0.1:${port}/api  (app origin ${config.publicUrl.origin})`);
  if (!config.google.configured) console.log("Google OAuth not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to link accounts.");
});
