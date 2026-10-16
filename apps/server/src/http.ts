import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { config } from "./config.ts";
import { randomToken, sha256 } from "./crypto.ts";
import { db } from "./db.ts";

export type User = { id: string; name: string; email: string; password_hash: string | null; default_account_id: string | null };
export type AppEnv = { Variables: { user: User } };

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 501 | 502 | 503, error: string, code?: string) =>
  new HTTPException(status, { res: Response.json({ error, code }, { status }) });

const COOKIE = "tube_session";
const SESSION_DAYS = 30;

export function startSession(c: Context, userId: string, method: "local" | "oidc" = "local") {
  const token = randomToken();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, method) VALUES (?, ?, ?, ?)").run(sha256(token), userId, Date.now() + SESSION_DAYS * 864e5, method);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export function endSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
  deleteCookie(c, COOKIE, { path: "/" });
}

export function sessionUser(c: Context): User | null {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.password_hash, u.default_account_id, s.method FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as (User & { method: string }) | undefined;
  if (!row) return null;
  // With OIDC on, sessions from password or passkey sign-in no longer count.
  if (config.oidc.enabled && row.method !== "oidc") {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
    return null;
  }
  const { method: _method, ...user } = row;
  return user;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = sessionUser(c);
  if (!user) throw fail(401, "Sign in required.", "unauthenticated");
  c.set("user", user);
  await next();
};

/**
 * CSRF protection for state-changing requests: the browser's Origin must be the app's.
 * Combined with SameSite=Lax session cookies.
 */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin !== config.publicUrl.origin) {
      throw fail(403, `Open the app at ${config.publicUrl.origin} (this page is at ${origin ?? "an unknown address"}).`, "bad_origin");
    }
  }
  await next();
};
