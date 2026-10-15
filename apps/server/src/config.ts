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
  secureCookies: publicUrl.protocol === "https:",
};
