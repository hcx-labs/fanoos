import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

const env = process.env;

/** Settings every backend service shares. Each service reads its own .env. */
export function serviceConfig(name: string, defaultPort: number) {
  const dataDir = resolve(env.DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true });
  return {
    name,
    port: Number(env.PORT ?? defaultPort),
    /** Listen address: loopback by default; 0.0.0.0 in containers. */
    host: env.HOST || "127.0.0.1",
    dataDir,
    secret: loadSecret(dataDir),
    /** Shared with Fanoos core; every /v1 request must present it. */
    token: env.BACKEND_TOKEN ?? "",
    /** The app's public origin (OAuth redirects come back through core's proxy). */
    publicUrl: new URL(env.PUBLIC_URL ?? "http://localhost:5180"),
    redisUrl: env.REDIS_URL ?? "",
    cacheTtlSeconds: Number(env.CACHE_TTL_SECONDS ?? 600),
    cacheStaleSeconds: Number(env.CACHE_STALE_SECONDS ?? 86_400),
  };
}

export type ServiceConfig = ReturnType<typeof serviceConfig>;

/** Encryption and signing secret, generated once into the data folder if not provided. */
function loadSecret(dataDir: string): Buffer {
  if (env.SECRET_KEY) {
    const key = Buffer.from(env.SECRET_KEY, "base64");
    if (key.length < 32) throw new Error("SECRET_KEY must be at least 32 bytes, base64-encoded.");
    return key;
  }
  const file = join(dataDir, "secret.key");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(readFileSync(file, "utf8"), "base64");
}
