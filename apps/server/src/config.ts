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
  /** Where the web app is served. Cookies, OAuth redirects and passkeys are bound to this origin. */
  publicUrl,
  dataDir,
  secret: loadSecret(),
  /** Display name for passkey prompts. */
  appName: env.APP_NAME ?? "Fanoos",
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
    redirectUri: new URL("/api/links/google/callback", publicUrl).toString(),
  },
  /** Redis for the shared response cache; empty falls back to a small in-memory cache. */
  redisUrl: env.REDIS_URL ?? "",
  /** How long cached YouTube responses live. */
  cacheTtlSeconds: Number(env.CACHE_TTL_SECONDS ?? 600),
  /** After expiring, how long cached responses are still served while a refresh runs. */
  cacheStaleSeconds: Number(env.CACHE_STALE_SECONDS ?? 86_400),
  /** YouTube Data API key for public lookups (video stats, categories); saves linked accounts' quota. */
  youtubeApiKey: env.YOUTUBE_API_KEY ?? "",
  /** Invidious companion: generates YouTube's anti-bot tokens and streams video. */
  companion: {
    url: (env.COMPANION_URL ?? "").replace(/\/$/, ""),
    /** Optional signed-in instance, used only for videos YouTube age-restricts. */
    signedInUrl: (env.COMPANION_SIGNED_IN_URL ?? "").replace(/\/$/, ""),
    secret: env.COMPANION_SECRET ?? "",
    get configured() {
      return Boolean(this.url && this.secret);
    },
  },
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
