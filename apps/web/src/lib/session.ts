/*
 * The signed-in profile and its linked accounts, loaded from the server.
 * A tiny external store so hooks and plain functions share one copy.
 */
import { useMemo, useSyncExternalStore } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api, RequestError } from "./api";
import { clearAppData, loadAppData } from "./store";
import type { Backend, BackendFeature, LinkedAccount, Me } from "./types";

type Session = { status: "loading" } | { status: "signed-out" } | { status: "error"; error: string } | { status: "ready"; me: Me };

let session: Session = { status: "loading" };
const listeners = new Set<() => void>();
const emit = (next: Session) => {
  session = next;
  listeners.forEach((l) => l());
};

let dataFor: string | null = null;

export async function refreshSession() {
  try {
    const me = await api<Me>("/auth/me");
    // Load the account's app data before showing the app, once per account.
    if (dataFor !== me.profile.id) {
      await loadAppData();
      dataFor = me.profile.id;
    }
    emit({ status: "ready", me });
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) emit({ status: "signed-out" });
    else emit({ status: "error", error: (error as Error).message });
  }
}
void refreshSession();

export const useSession = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
  );

export const useProfile = () => {
  const s = useSession();
  return s.status === "ready" ? s.me.profile : null;
};

/** Backends, linked accounts, the default account, and the accounts that feed the home page. */
export function useAccounts() {
  const s = useSession();
  return useMemo(() => {
    const me = s.status === "ready" ? s.me : null;
    const backends = me?.backends ?? [];
    const accounts = me?.accounts ?? [];
    const active = accounts.find((a) => a.id === me?.defaultAccountId) ?? accounts[0] ?? null;
    const inFeed = accounts.filter((a) => a.inFeed && !a.needsRelink);
    const backendOf = (account: LinkedAccount) => backends.find((b) => b.id === account.backendId);
    const bySlug = (slug: string | undefined) => backends.find((b) => b.slug === (slug ?? "youtube"));
    /** Usable accounts on one backend; the default account first when it's one of them. */
    const accountsOn = (slug: string | undefined) => {
      const backend = bySlug(slug);
      const list = accounts.filter((a) => a.backendId === backend?.id && !a.needsRelink);
      return active && list.includes(active) ? [active, ...list.filter((a) => a !== active)] : list;
    };
    return {
      backends,
      accounts,
      active,
      inFeed,
      backendOf,
      bySlug,
      accountsOn,
      /** Whether a backend offers a feature (comments, ratings…). */
      can: (slug: string | undefined, feature: BackendFeature) => bySlug(slug)?.info?.features.includes(feature) ?? false,
      /** Backends with at least one linked account in the feed, in display order. */
      feedBackends: backends.filter((b) => inFeed.some((a) => a.backendId === b.id)),
      byId: (id: string) => accounts.find((a) => a.id === id),
    };
  }, [s]);
}

/** Apply a change locally right away, then confirm with the server. */
async function optimistic(change: (me: Me) => Me, request: () => Promise<unknown>) {
  if (session.status === "ready") emit({ status: "ready", me: change(session.me) });
  try {
    await request();
  } finally {
    await refreshSession();
  }
}

export const accountActions = {
  update(id: string, patch: { label?: string; inFeed?: boolean }) {
    return optimistic(
      (me) => ({ ...me, accounts: me.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
      () => api(`/accounts/${id}`, { method: "PATCH", body: patch }),
    );
  },
  remove(id: string) {
    return optimistic(
      (me) => ({ ...me, accounts: me.accounts.filter((a) => a.id !== id) }),
      () => api(`/accounts/${id}`, { method: "DELETE" }),
    );
  },
  setDefault(id: string) {
    return optimistic((me) => ({ ...me, defaultAccountId: id }), () => api("/accounts/default", { method: "PUT", body: { id } }));
  },
  sync(id: string) {
    return api(`/accounts/${id}/sync`, { method: "POST", body: {} });
  },
  renameBackend(id: string, label: string) {
    return optimistic(
      (me) => ({ ...me, backends: me.backends.map((b) => (b.id === id ? { ...b, label } : b)) }),
      () => api(`/backends/${id}`, { method: "PATCH", body: { label } }),
    );
  },
  /**
   * Start linking an account on a backend. Redirect flows leave the page for the service's
   * sign-in; device flows return a code to show while `waitForLink` polls. `write` also asks
   * for permission to act as the account; `accountId` re-links or upgrades that account.
   */
  async link(backendId: string, returnTo: "home" | "settings" = "settings", opts: { write?: boolean; accountId?: string } = {}): Promise<DeviceLink | null> {
    const res = await api<LinkResponse>("/links", { body: { backendId, returnTo, write: opts.write, accountId: opts.accountId } });
    if (res.kind === "redirect") {
      window.location.assign(res.url);
      return null;
    }
    return res;
  },
  /** Poll a device flow until it's linked, failed, or `signal` aborts. */
  async waitForLink(link: DeviceLink, signal: AbortSignal): Promise<{ accountId: string }> {
    const deadline = Date.now() + link.expiresIn * 1000;
    while (!signal.aborted && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, link.interval * 1000));
      if (signal.aborted) break;
      const status = await api<LinkPoll>(`/links/${link.flow}`).catch(() => ({ status: "pending" }) as LinkPoll);
      if (status.status === "linked") {
        await refreshSession();
        return { accountId: status.accountId };
      }
      if (status.status === "failed") throw Object.assign(new Error(status.error), { code: status.code });
    }
    throw Object.assign(new Error(signal.aborted ? "Cancelled." : "The code expired. Start again for a new one."), { code: signal.aborted ? "cancelled" : "expired" });
  },
};

export type DeviceLink = { kind: "device"; flow: string; code: string; verifyUrl: string; expiresIn: number; interval: number };
type LinkResponse = { kind: "redirect"; url: string } | DeviceLink;
type LinkPoll = { status: "pending" } | { status: "linked"; accountId: string } | { status: "failed"; error: string; code?: string };

/** A backend's display name, falling back to its slug while it's unreachable. */
export const backendName = (backend: Backend | undefined) => backend?.info?.name ?? backend?.slug ?? "Unknown";

export const authActions = {
  async register(name: string, email: string, password: string) {
    await api("/auth/register", { body: { name, email, password } });
    await refreshSession();
  },
  async signIn(email: string, password: string) {
    await api("/auth/login", { body: { email, password } });
    await refreshSession();
  },
  async passkeySignIn() {
    const { flow, options } = await api<{ flow: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
      "/auth/passkey/login/options",
      { body: {} },
    );
    const response = await startAuthentication({ optionsJSON: options });
    await api("/auth/passkey/login/verify", { body: { flow, response } });
    await refreshSession();
  },
  /** Create a profile with a passkey, or (when signed in) add another passkey. */
  async passkeyRegister(profile?: { name: string; email: string }) {
    const { flow, options } = await api<{ flow: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
      "/auth/passkey/register/options",
      { body: profile ?? {} },
    );
    const response = await startRegistration({ optionsJSON: options });
    await api("/auth/passkey/register/verify", { body: { flow, response } });
    await refreshSession();
  },
  async rename(name: string) {
    await api("/auth/me", { method: "PATCH", body: { name } });
    await refreshSession();
  },
  async signOut() {
    await api("/auth/logout", { body: {} }).catch(() => {});
    clearAppData();
    dataFor = null;
    emit({ status: "signed-out" });
  },
};

/** How this server signs people in. With OIDC on, it's the only way. */
export type AuthConfig = { oidc: { name: string } | null };
let authConfig: Promise<AuthConfig> | null = null;
export const getAuthConfig = () => (authConfig ??= api<AuthConfig>("/auth/config").catch(() => ({ oidc: null })));
