import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

const env = process.env;

const dataDir = resolve(env.DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });

/** Server secret for encryption and signing. Generated once for development if not provided. */
function loadSecret(): Buffer {
  if (env.SECRET_KEY) {
    const key = Buffer.from(env.SECRET_KEY, "base64");
    if (key.length < 32) throw new Error("SECRET_KEY must be at least 32 bytes, base64-encoded.");
    return key;
  }
  const file = join(dataDir, "secret.key");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(readFileSync(file, "utf8"), "base64");
}

const publicUrl = new URL(env.PUBLIC_URL ?? "http://localhost:5180");

export const config = {
  port: Number(env.PORT ?? 8787),
  /** Listen address: loopback by default; 0.0.0.0 in containers. */
  host: env.HOST || "127.0.0.1",
  /** The built web app (apps/web/dist) to serve alongside the API; empty when Vite serves it (development). */
  webRoot: env.WEB_ROOT ?? "",
  /** Where the web app is served. Cookies, OAuth redirects and passkeys are bound to this origin. */
  publicUrl,
  dataDir,
  secret: loadSecret(),
  /** Display name for passkey prompts. */
  appName: env.APP_NAME ?? "Fanoos",
  /**
   * Backend services (provider protocol v1), as "slug=url" pairs: e.g.
   * BACKENDS=youtube=http://127.0.0.1:8788,crunchyroll=http://127.0.0.1:8789,plex=http://127.0.0.1:8790
   * The slug appears in app URLs (/watch/youtube/<id>); the order is the display order.
   */
  backends: (env.BACKENDS ?? "youtube=http://127.0.0.1:8788")
    .split(",")
    .map((pair) => pair.trim().split("="))
    .filter((p): p is [string, string] => Boolean(p[0] && p[1]))
    .map(([slug, url]) => ({ slug: slug.trim(), url: url.trim().replace(/\/$/, "") })),
  /** Shared secret every backend checks. */
  backendToken: env.BACKEND_TOKEN ?? "",
  /**
   * OpenID Connect sign-in. Setting OIDC_ISSUER turns it on, and then password
   * and passkey sign-in are disabled entirely.
   */
  oidc: {
    issuer: (env.OIDC_ISSUER ?? "").replace(/\/$/, ""),
    clientId: env.OIDC_CLIENT_ID ?? "",
    clientSecret: env.OIDC_CLIENT_SECRET ?? "",
    scopes: env.OIDC_SCOPES ?? "openid email profile",
    /** Shown on the sign-in button, e.g. "Authentik". */
    name: env.OIDC_NAME ?? "SSO",
    get enabled() {
      return Boolean(this.issuer);
    },
    redirectUri: new URL("/api/auth/oidc/callback", publicUrl).toString(),
  },
  secureCookies: publicUrl.protocol === "https:",
};
