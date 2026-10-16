/*
 * OpenID Connect sign-in (authorization code flow with PKCE, state and nonce).
 * Enabled by OIDC_ISSUER; when on, password and passkey sign-in are disabled.
 * Accounts are created automatically on first sign-in. An existing Fanoos account
 * with the same email is linked only when the provider says the email is verified.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config.ts";
import { randomToken } from "../crypto.ts";
import { db, pending } from "../db.ts";
import { fail, startSession } from "../http.ts";
import { createUser, findUserByEmail } from "../users.ts";

const oidc = config.oidc;

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
};

let discovery: Promise<Discovery> | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** The provider's configuration, fetched once (and again after a failure). */
function provider(): Promise<Discovery> {
  discovery ??= fetch(`${oidc.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })
    .then(async (res) => {
      if (!res.ok) throw new Error(`OIDC discovery ${res.status}`);
      const doc = (await res.json()) as Discovery;
      jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
      return doc;
    })
    .catch((error) => {
      discovery = null;
      throw error;
    });
  return discovery;
}

const STATE_COOKIE = "tube_oidc";

export const oidcRoutes = new Hono();

oidcRoutes.get("/start", async (c) => {
  if (!oidc.enabled) throw fail(404, "OIDC sign-in isn't enabled.");
  const doc = await provider().catch(() => {
    throw fail(502, "Couldn't reach the sign-in provider.", "oidc_unreachable");
  });
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  pending.put("oidc", state, { nonce, verifier }, 10 * 60_000);
  // Ties the callback to this browser (prevents login CSRF). Lax so it survives the top-level redirect back.
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: config.secureCookies, sameSite: "Lax", path: "/api/auth/oidc", maxAge: 600 });
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: oidc.clientId,
    redirect_uri: oidc.redirectUri,
    scope: oidc.scopes,
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return c.redirect(url.toString());
});

oidcRoutes.get("/callback", async (c) => {
  if (!oidc.enabled) throw fail(404, "OIDC sign-in isn't enabled.");
  const failed = (reason: string) => c.redirect(`/welcome?sso_error=${encodeURIComponent(reason)}`);
  const state = c.req.query("state") ?? "";
  const cookieState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth/oidc" });
  const saved = pending.take<{ nonce: string; verifier: string }>("oidc", state);
  if (!saved || !cookieState || cookieState !== state) return failed("expired");
  if (c.req.query("error")) return failed(c.req.query("error") === "access_denied" ? "denied" : "provider");
  const code = c.req.query("code");
  if (!code) return failed("provider");

  try {
    const doc = await provider();
    // client_secret_basic is the spec default; use client_secret_post only if that's all the provider supports.
    const methods = doc.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
    const usePost = !methods.includes("client_secret_basic") && methods.includes("client_secret_post");
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: oidc.redirectUri, code_verifier: saved.verifier });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (usePost) {
      body.set("client_id", oidc.clientId);
      body.set("client_secret", oidc.clientSecret);
    } else {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(oidc.clientId)}:${encodeURIComponent(oidc.clientSecret)}`).toString("base64")}`;
    }
    const tokenRes = await fetch(doc.token_endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
    if (!tokenRes.ok) throw new Error(`token endpoint ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
    const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    if (!tokens.id_token) throw new Error("no id_token in token response");

    const { payload } = await jwtVerify(tokens.id_token, jwks!, { issuer: doc.issuer, audience: oidc.clientId });
    if (payload.nonce !== saved.nonce) throw new Error("nonce mismatch");

    // Some providers only put email/name in the userinfo response.
    let claims: JWTPayload & { email?: string; email_verified?: boolean; name?: string; preferred_username?: string } = payload;
    if ((!claims.email || !claims.name) && doc.userinfo_endpoint && tokens.access_token) {
      const info = await fetch(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
      if (info.ok) {
        const extra = (await info.json()) as typeof claims;
        if (extra.sub === payload.sub) {
          claims = { ...extra, ...payload, email: (payload.email as string | undefined) ?? extra.email, name: (payload.name as string | undefined) ?? extra.name };
        }
      }
    }

    const userId = resolveUser(doc.issuer, payload.sub!, claims);
    if (!userId) return failed("email_taken");
    startSession(c, userId, "oidc");
    return c.redirect("/");
  } catch (error) {
    console.warn("OIDC sign-in failed:", (error as Error).message);
    return failed("provider");
  }
});

/** Find the user for this identity, link a verified-email match, or create one. Null if the email belongs to someone else. */
function resolveUser(
  issuer: string,
  subject: string,
  claims: { email?: string; email_verified?: boolean; name?: string; preferred_username?: string },
): string | null {
  const known = db.prepare("SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?").get(issuer, subject) as
    | { user_id: string }
    | undefined;
  if (known) return known.user_id;

  const email = (claims.email ?? "").trim().toLowerCase() || `${subject}@${new URL(issuer).hostname}`;
  const name = (claims.name || claims.preferred_username || email.split("@")[0] || "User").slice(0, 80);
  const existing = findUserByEmail(email);
  let userId: string;
  if (existing) {
    // Only take over an existing account when the provider vouches for the email.
    if (claims.email_verified !== true) return null;
    userId = existing.id;
  } else {
    userId = createUser(name, email, null);
  }
  db.prepare("INSERT INTO oidc_identities (issuer, subject, user_id) VALUES (?, ?, ?)").run(issuer, subject, userId);
  return userId;
}
