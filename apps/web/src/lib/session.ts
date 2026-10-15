/*
 * The signed-in profile and its linked accounts, loaded from the server.
 * A tiny external store so hooks and plain functions share one copy.
 */
import { useMemo, useSyncExternalStore } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api, RequestError } from "./api";
import { clearAppData, loadAppData } from "./store";
import type { LinkedAccount, Me } from "./types";

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
    return {
      backends,
      accounts,
      active,
      inFeed,
      googleConfigured: me?.googleConfigured ?? false,
      backendOf: (account: LinkedAccount) => backends.find((b) => b.id === account.backendId),
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
  /** Start Google sign-in for a new (or re-linked) account. Leaves the page. */
  link(backendId: string, returnTo: "home" | "settings" = "settings") {
    window.location.assign(`/api/links/google/start?backend=${encodeURIComponent(backendId)}&return=${returnTo}`);
  },
};

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
