/*
 * Serves the built web app (WEB_ROOT, e.g. apps/web/dist) next to the API, so one container
 * is the whole app. Hashed assets are cached for a year; every other path that isn't a file
 * gets index.html (the app's own router handles it).
 */
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import type { Context } from "hono";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

export function webApp(root: string) {
  const base = resolve(root);
  const file = async (path: string) => {
    const full = normalize(join(base, path));
    if (!full.startsWith(base)) return null;
    try {
      return (await stat(full)).isFile() ? full : null;
    } catch {
      return null;
    }
  };
  return async (c: Context) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    const found = (await file(path)) ?? (await file("index.html"));
    if (!found) return c.text("The web app isn't built.", 500);
    const isIndex = found.endsWith("index.html");
    return c.body(await readFile(found), 200, {
      "content-type": types[extname(found)] ?? "application/octet-stream",
      "cache-control": isIndex ? "no-cache" : path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
    });
  };
}
