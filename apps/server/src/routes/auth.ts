import { Hono } from "hono";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { config } from "../config.ts";
import { hashPassword, randomToken, verifyPassword } from "../crypto.ts";
import { db, pending } from "../db.ts";
import { type AppEnv, endSession, fail, requireUser, sessionUser, startSession } from "../http.ts";
import { createUser, findUserByEmail, me } from "../users.ts";

const rpID = config.publicUrl.hostname;
const origin = config.publicUrl.origin;

const email = (value: unknown) => {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(v) || v.length > 254) throw fail(422, "Enter a valid email address.", "email");
  return v;
};
const password = (value: unknown) => {
  if (typeof value !== "string" || value.length < 10) throw fail(422, "Use at least 10 characters.", "password");
  if (value.length > 256) throw fail(422, "That password is too long.", "password");
  return value;
};

export const authRoutes = new Hono<AppEnv>();

/** Public: how this server signs people in (read by the sign-in page). */
authRoutes.get("/config", (c) => c.json({ oidc: config.oidc.enabled ? { name: config.oidc.name } : null }));

// With OIDC on, password and passkey sign-in, sign-up and passkey registration are off.
for (const path of ["/register", "/login", "/passkey/*"]) {
  authRoutes.use(path, async (_c, next) => {
    if (config.oidc.enabled) throw fail(403, `Sign in with ${config.oidc.name} instead.`, "oidc_only");
    await next();
  });
}

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{ name?: string; email?: string; password?: string }>();
  const name = body.name?.trim().slice(0, 80);
  if (!name) throw fail(422, "Enter your name.", "name");
  const address = email(body.email);
  if (findUserByEmail(address)) throw fail(409, "An account with this email already exists.", "email_taken");
  const id = createUser(name, address, await hashPassword(password(body.password)));
  startSession(c, id);
  return c.json({ ok: true });
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const user = findUserByEmail(email(body.email));
  // Same message and similar timing whether or not the account exists.
  const ok = user?.password_hash ? await verifyPassword(String(body.password ?? ""), user.password_hash) : (await hashPassword("x"), false);
  if (!user || !ok) throw fail(401, "Email or password is incorrect.", "bad_credentials");
  startSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

// Passkey sign-in (discoverable credentials: no email needed).
authRoutes.post("/passkey/login/options", async (c) => {
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const flow = randomToken(16);
  pending.put("passkey-login", flow, { challenge: options.challenge }, 5 * 60_000);
  return c.json({ flow, options });
});

authRoutes.post("/passkey/login/verify", async (c) => {
  const { flow, response } = await c.req.json<{ flow: string; response: AuthenticationResponseJSON }>();
  const state = pending.take<{ challenge: string }>("passkey-login", flow);
  if (!state) throw fail(400, "This sign-in attempt expired. Try again.");
  const row = db.prepare("SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?").get(response.id) as
    | { id: string; user_id: string; public_key: Uint8Array; counter: number; transports: string | null }
    | undefined;
  if (!row) throw fail(401, "This passkey isn't registered here.", "unknown_passkey");
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: state.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: row.id,
      publicKey: new Uint8Array(row.public_key),
      counter: row.counter,
      transports: row.transports ? (JSON.parse(row.transports) as AuthenticatorTransport[]) : undefined,
    },
  }).catch(() => ({ verified: false as const, authenticationInfo: undefined }));
  if (!result.verified || !result.authenticationInfo) throw fail(401, "Passkey verification failed.");
  db.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").run(result.authenticationInfo.newCounter, row.id);
  startSession(c, row.user_id);
  return c.json({ ok: true });
});

// Passkey sign-up: creates the profile together with its first passkey.
authRoutes.post("/passkey/register/options", async (c) => {
  const signedIn = sessionUser(c)?.id ?? null;
  let name: string, address: string;
  if (signedIn) {
    const u = db.prepare("SELECT name, email FROM users WHERE id = ?").get(signedIn) as { name: string; email: string };
    ({ name, email: address } = u);
  } else {
    const body = await c.req.json<{ name?: string; email?: string }>();
    name = body.name?.trim().slice(0, 80) ?? "";
    if (!name) throw fail(422, "Enter your name.", "name");
    address = email(body.email);
    if (findUserByEmail(address)) throw fail(409, "An account with this email already exists. Sign in instead.", "email_taken");
  }
  const existing = signedIn
    ? (db.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").all(signedIn) as { id: string; transports: string | null }[])
    : [];
  const options = await generateRegistrationOptions({
    rpName: config.appName,
    rpID,
    userName: address,
    userDisplayName: name,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const flow = randomToken(16);
  pending.put("passkey-register", flow, { challenge: options.challenge, userId: signedIn, name, email: address }, 5 * 60_000);
  return c.json({ flow, options });
});

authRoutes.post("/passkey/register/verify", async (c) => {
  const { flow, response } = await c.req.json<{ flow: string; response: RegistrationResponseJSON }>();
  const state = pending.take<{ challenge: string; userId: string | null; name: string; email: string }>("passkey-register", flow);
  if (!state) throw fail(400, "This attempt expired. Try again.");
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: state.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  }).catch(() => ({ verified: false as const, registrationInfo: undefined }));
  if (!result.verified || !result.registrationInfo) throw fail(400, "Passkey couldn't be verified.");
  let userId = state.userId;
  if (!userId) {
    if (findUserByEmail(state.email)) throw fail(409, "An account with this email already exists.", "email_taken");
    userId = createUser(state.name, state.email, null);
  }
  const { credential } = result.registrationInfo;
  db.prepare("INSERT INTO passkeys (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    credential.id,
    userId,
    credential.publicKey,
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    Date.now(),
  );
  if (!state.userId) startSession(c, userId);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => c.json(me(c.get("user"))));

authRoutes.patch("/me", requireUser, async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim().slice(0, 80);
  if (!name) throw fail(422, "Enter your name.", "name");
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, c.get("user").id);
  return c.json({ ok: true });
});
