import { Hono } from "hono";
import type { LinkStart, LinkStatus, ProviderAccount } from "@tube/shared";
import { BackendError, call, infoOf, refreshInfos, relay } from "../backends.ts";
import { config } from "../config.ts";
import { randomId, randomToken } from "../crypto.ts";
import { db, pending } from "../db.ts";
import { type AppEnv, fail, requireUser } from "../http.ts";

export const accountRoutes = new Hono<AppEnv>();
accountRoutes.use("*", requireUser);

const ownBackend = (userId: string, backendId: unknown) => {
  const row = db.prepare("SELECT id, slug FROM backends WHERE id = ? AND user_id = ?").get(String(backendId), userId) as { id: string; slug: string } | undefined;
  if (!row) throw fail(404, "Backend not found.");
  return row;
};

const ownAccount = (userId: string, accountId: string) => {
  const row = db
    .prepare("SELECT a.id, a.ref, b.slug FROM accounts a JOIN backends b ON b.id = a.backend_id WHERE a.id = ? AND a.user_id = ?")
    .get(accountId, userId) as { id: string; ref: string | null; slug: string } | undefined;
  if (!row) throw fail(404, "Account not found.");
  return row;
};

accountRoutes.patch("/accounts/:id", async (c) => {
  const user = c.get("user");
  ownAccount(user.id, c.req.param("id"));
  const body = await c.req.json<{ label?: string; inFeed?: boolean }>();
  if (typeof body.label === "string" && body.label.trim()) {
    db.prepare("UPDATE accounts SET label = ? WHERE id = ?").run(body.label.trim().slice(0, 40), c.req.param("id"));
  }
  if (typeof body.inFeed === "boolean") db.prepare("UPDATE accounts SET in_feed = ? WHERE id = ?").run(body.inFeed ? 1 : 0, c.req.param("id"));
  return c.json({ ok: true });
});

accountRoutes.delete("/accounts/:id", async (c) => {
  const row = ownAccount(c.get("user").id, c.req.param("id"));
  // The backend revokes access at the service too, so unlinking really removes it.
  if (row.ref) await call(row.slug, `/accounts/${encodeURIComponent(row.ref)}`, { method: "DELETE" }).catch((error) => console.warn("unlink at backend failed:", (error as Error).message));
  db.prepare("DELETE FROM accounts WHERE id = ?").run(row.id);
  return c.json({ ok: true });
});

accountRoutes.put("/accounts/default", async (c) => {
  const { id } = await c.req.json<{ id: string }>();
  ownAccount(c.get("user").id, id);
  db.prepare("UPDATE users SET default_account_id = ? WHERE id = ?").run(id, c.get("user").id);
  return c.json({ ok: true });
});

accountRoutes.post("/accounts/:id/sync", async (c) => {
  const row = ownAccount(c.get("user").id, c.req.param("id"));
  if (!row.ref) throw fail(409, "This account needs to be linked again.", "relink");
  await call(row.slug, "/following", { accounts: [row.ref], query: { refresh: "1" } }).catch(relay);
  return c.json({ ok: true });
});

accountRoutes.patch("/backends/:id", async (c) => {
  ownBackend(c.get("user").id, c.req.param("id"));
  const { label } = await c.req.json<{ label?: string }>();
  if (label?.trim()) db.prepare("UPDATE backends SET label = ? WHERE id = ?").run(label.trim().slice(0, 40), c.req.param("id"));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Linking, for any backend. Redirect flows leave for the service's sign-in page and come back
// through /api/links/complete; device flows show a code while the app polls /api/links/:flow.

type CoreFlow = { userId: string; backendId: string; slug: string; flow: string; accountId?: string; write?: boolean; returnTo: string };

export type LinkResponse =
  | { kind: "redirect"; url: string }
  | { kind: "device"; flow: string; code: string; verifyUrl: string; expiresIn: number; interval: number };

accountRoutes.post("/links", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ backendId?: string; write?: boolean; accountId?: string; returnTo?: string }>();
  const backend = ownBackend(user.id, body.backendId);
  if (!infoOf(backend.slug)) await refreshInfos();
  const existing = body.accountId ? ownAccount(user.id, body.accountId) : undefined;
  const id = randomToken(24);
  const start = await call<LinkStart>(backend.slug, "/links", {
    body: {
      returnUrl: new URL(`/api/links/complete?f=${id}`, config.publicUrl).toString(),
      write: body.write,
      account: existing?.ref ?? undefined,
    },
  }).catch(relay);
  const returnTo = body.returnTo === "home" ? "/" : "/settings";
  pending.put("link", id, { userId: user.id, backendId: backend.id, slug: backend.slug, flow: start.flow, accountId: existing?.id, write: body.write, returnTo } satisfies CoreFlow, 15 * 60_000);
  const response: LinkResponse =
    start.kind === "redirect"
      ? { kind: "redirect", url: start.url }
      : { kind: "device", flow: id, code: start.code, verifyUrl: start.verifyUrl, expiresIn: start.expiresIn, interval: start.interval };
  return c.json(response);
});

/** Ask the backend how a flow is going; on success, add (or update) the linked account. */
async function settle(userId: string, id: string): Promise<{ status: "pending" } | { status: "linked"; accountId: string; write?: boolean } | { status: "failed"; error: string; code?: string }> {
  const flow = pending.get<CoreFlow>("link", id);
  if (!flow || flow.userId !== userId) return { status: "failed", error: "That sign-in expired. Try again.", code: "expired" };
  let status: LinkStatus;
  try {
    status = await call<LinkStatus>(flow.slug, `/links/${encodeURIComponent(flow.flow)}`);
  } catch (error) {
    if (error instanceof BackendError) return { status: "failed", error: error.message, code: error.code };
    throw error;
  }
  if (status.status === "pending") return status;
  pending.delete(id);
  if (status.status === "failed") return status;
  return { status: "linked", accountId: register(userId, flow, status.account), write: status.write };
}

function register(userId: string, flow: CoreFlow, account: ProviderAccount): string {
  const provider = infoOf(flow.slug)?.kind ?? flow.slug;
  // Same backend account linked again (re-link, or a new flow for an account already here): update it.
  const existing = (flow.accountId
    ? db.prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?").get(flow.accountId, userId)
    : db.prepare("SELECT id FROM accounts WHERE user_id = ? AND backend_id = ? AND ref = ?").get(userId, flow.backendId, account.ref)) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE accounts SET ref = ?, name = ?, email = ?, avatar = ?, can_write = ?, plan = ?, needs_relink = 0 WHERE id = ?").run(
      account.ref,
      account.name,
      account.email ?? "",
      account.avatar ?? null,
      account.canWrite ? 1 : 0,
      account.plan ?? null,
      existing.id,
    );
    return existing.id;
  }
  const id = randomId();
  const n = (db.prepare("SELECT COUNT(*) AS n FROM accounts a JOIN backends b ON b.id = a.backend_id WHERE a.user_id = ? AND b.slug = ?").get(userId, flow.slug) as { n: number }).n;
  const name = infoOf(flow.slug)?.name ?? flow.slug;
  db.prepare(
    `INSERT INTO accounts (id, user_id, backend_id, label, name, email, avatar, google_sub, provider, ref, can_write, plan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    flow.backendId,
    n === 0 ? (provider === "youtube" ? "Personal" : name) : `${name} ${n + 1}`,
    account.name,
    account.email ?? "",
    account.avatar ?? null,
    `${flow.slug}:${account.ref}`,
    provider,
    account.ref,
    account.canWrite ? 1 : 0,
    account.plan ?? null,
    Date.now(),
  );
  return id;
}

// Redirect flows end here: the backend sends the browser back once the service answered.
accountRoutes.get("/links/complete", async (c) => {
  const id = c.req.query("f") ?? "";
  const flow = pending.get<CoreFlow>("link", id);
  const returnTo = flow?.returnTo ?? "/settings";
  const hash = returnTo === "/settings" ? "#accounts" : "";
  const result = await settle(c.get("user").id, id);
  if (result.status === "linked") {
    const asked = flow?.write && result.write === false ? "link_error=write_denied" : `linked=${result.accountId}${flow?.write ? "&actions=1" : ""}`;
    return c.redirect(`${returnTo}?${asked}${hash}`);
  }
  const code = result.status === "failed" ? (result.code ?? "provider") : "pending";
  return c.redirect(`${returnTo}?link_error=${encodeURIComponent(code)}${hash}`);
});

// After /links/complete, so "complete" isn't taken for a flow id.
accountRoutes.get("/links/:flow", async (c) => c.json(await settle(c.get("user").id, c.req.param("flow"))));
