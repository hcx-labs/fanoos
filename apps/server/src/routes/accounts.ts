import { Hono } from "hono";
import { config } from "../config.ts";
import { decrypt, encrypt, randomId, randomToken } from "../crypto.ts";
import { db, pending } from "../db.ts";
import { authorizationUrl, canWrite, exchangeCode, revoke, userInfo } from "../google.ts";
import { type AppEnv, fail, requireUser, sessionUser } from "../http.ts";
import { syncSubscriptions } from "../youtube/feed.ts";

export const accountRoutes = new Hono<AppEnv>();

const ownBackend = (userId: string, backendId: string) =>
  db.prepare("SELECT id, local FROM backends WHERE id = ? AND user_id = ?").get(backendId, userId) as { id: string; local: number } | undefined;

const ownAccount = (userId: string, accountId: string) => {
  const row = db.prepare("SELECT id, refresh_token FROM accounts WHERE id = ? AND user_id = ?").get(accountId, userId) as
    | { id: string; refresh_token: string | null }
    | undefined;
  if (!row) throw fail(404, "Account not found.");
  return row;
};

accountRoutes.patch("/accounts/:id", requireUser, async (c) => {
  const user = c.get("user");
  ownAccount(user.id, c.req.param("id"));
  const body = await c.req.json<{ label?: string; inFeed?: boolean }>();
  if (typeof body.label === "string" && body.label.trim()) {
    db.prepare("UPDATE accounts SET label = ? WHERE id = ?").run(body.label.trim().slice(0, 40), c.req.param("id"));
  }
  if (typeof body.inFeed === "boolean") db.prepare("UPDATE accounts SET in_feed = ? WHERE id = ?").run(body.inFeed ? 1 : 0, c.req.param("id"));
  return c.json({ ok: true });
});

accountRoutes.delete("/accounts/:id", requireUser, async (c) => {
  const user = c.get("user");
  const row = ownAccount(user.id, c.req.param("id"));
  // Revoke at Google too, so unlinking really removes access.
  if (row.refresh_token) await revoke(decrypt(row.refresh_token));
  db.prepare("DELETE FROM accounts WHERE id = ?").run(row.id);
  return c.json({ ok: true });
});

accountRoutes.put("/accounts/default", requireUser, async (c) => {
  const user = c.get("user");
  const { id } = await c.req.json<{ id: string }>();
  ownAccount(user.id, id);
  db.prepare("UPDATE users SET default_account_id = ? WHERE id = ?").run(id, user.id);
  return c.json({ ok: true });
});

accountRoutes.post("/accounts/:id/sync", requireUser, async (c) => {
  const user = c.get("user");
  ownAccount(user.id, c.req.param("id"));
  await syncSubscriptions(c.req.param("id"), true);
  return c.json({ ok: true });
});

accountRoutes.patch("/backends/:id", requireUser, async (c) => {
  const user = c.get("user");
  if (!ownBackend(user.id, c.req.param("id"))) throw fail(404, "Backend not found.");
  const { label } = await c.req.json<{ label?: string }>();
  if (label?.trim()) db.prepare("UPDATE backends SET label = ? WHERE id = ?").run(label.trim().slice(0, 40), c.req.param("id"));
  return c.json({ ok: true });
});

accountRoutes.post("/backends", requireUser, () => {
  throw fail(501, "Remote backends aren't supported yet. Accounts link through this server for now.", "remote_backends");
});

// Linking: a top-level navigation to Google and back, so these are GET routes.
accountRoutes.get("/links/google/start", (c) => {
  const user = sessionUser(c);
  if (!user) return c.redirect("/welcome");
  if (!config.google.configured) return c.redirect("/settings?link_error=not_configured#accounts");
  const backendId = c.req.query("backend") ?? "";
  if (!ownBackend(user.id, backendId)) return c.redirect("/settings?link_error=backend#accounts");
  // write=1 also asks for permission to subscribe, rate and comment. account=<id>
  // upgrades an existing linked account (Google pre-selects it via login_hint).
  const write = c.req.query("write") === "1";
  const upgrading = c.req.query("account")
    ? (db.prepare("SELECT email FROM accounts WHERE id = ? AND user_id = ?").get(c.req.query("account")!, user.id) as { email: string } | undefined)
    : undefined;
  const state = randomToken(24);
  const { url, verifier } = authorizationUrl(state, { write, loginHint: upgrading?.email });
  pending.put("google-link", state, { userId: user.id, backendId, verifier, write, returnTo: c.req.query("return") === "home" ? "/" : "/settings" });
  return c.redirect(url);
});

accountRoutes.get("/links/google/callback", async (c) => {
  const state = pending.take<{ userId: string; backendId: string; verifier: string; write?: boolean; returnTo: string }>("google-link", c.req.query("state") ?? "");
  const user = sessionUser(c);
  // The state is single-use and must belong to the signed-in user who started the flow.
  if (!state || !user || user.id !== state.userId) return c.redirect("/settings?link_error=expired#accounts");
  const code = c.req.query("code");
  if (!code) return c.redirect(`/settings?link_error=${encodeURIComponent(c.req.query("error") ?? "denied")}#accounts`);

  const tokens = await exchangeCode(code, state.verifier);
  if (!tokens.scope.includes("youtube.readonly")) return c.redirect("/settings?link_error=scope#accounts");
  const who = await userInfo(tokens.access_token);
  const existing = db.prepare("SELECT id, refresh_token FROM accounts WHERE user_id = ? AND google_sub = ?").get(user.id, who.sub) as
    | { id: string; refresh_token: string | null }
    | undefined;

  const refresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : (existing?.refresh_token ?? null);
  let accountId = existing?.id;
  if (existing) {
    // Re-linking an account: refresh tokens and identity, keep the user's label and settings.
    db.prepare(
      "UPDATE accounts SET name = ?, email = ?, avatar = ?, refresh_token = ?, access_token = ?, access_expires = ?, scopes = ?, needs_relink = 0, synced_at = 0 WHERE id = ?",
    ).run(who.name ?? who.email, who.email, who.picture ?? null, refresh, encrypt(tokens.access_token), Date.now() + tokens.expires_in * 1000, tokens.scope, existing.id);
  } else {
    accountId = randomId();
    const n = (db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?").get(user.id) as { n: number }).n;
    db.prepare(
      `INSERT INTO accounts (id, user_id, backend_id, label, name, email, avatar, google_sub, refresh_token, access_token, access_expires, scopes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      accountId,
      user.id,
      state.backendId,
      n === 0 ? "Personal" : `Account ${n + 1}`,
      who.name ?? who.email,
      who.email,
      who.picture ?? null,
      who.sub,
      refresh,
      encrypt(tokens.access_token),
      Date.now() + tokens.expires_in * 1000,
      tokens.scope,
      Date.now(),
    );
  }
  // Pull the subscription list now so the feed is ready on return; errors surface later.
  await syncSubscriptions(accountId!, true).catch((error) => console.warn("initial sync failed:", (error as Error).message));
  // Asked for actions but Google's consent screen had that box unticked: linked read-only.
  const result = state.write && !canWrite(tokens.scope) ? "link_error=write_denied" : `linked=${accountId}${state.write ? "&actions=1" : ""}`;
  return c.redirect(`${state.returnTo}?${result}${state.returnTo === "/settings" ? "#accounts" : ""}`);
});
