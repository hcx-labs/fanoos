/*
 * Pasted links (search box, search page): any backend can claim a site through `linkHosts`
 * in its info; core asks that backend what the link points to.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, qs } from "./api";
import { paths } from "./paths";
import { backendName, useAccounts } from "./session";
import type { Backend, ResolvedLink } from "./types";

export type Resolved = ResolvedLink & { backend: string };

/** The backend whose site this text links to, if it's a single link. */
export function linkTarget(text: string, backends: Backend[]): { url: string; backend: Backend } | null {
  const raw = text.trim();
  if (!raw || /\s/.test(raw) || !raw.includes(".")) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const backend = backends.find((b) => b.info?.linkHosts.includes(host));
  return backend ? { url: url.toString(), backend } : null;
}

export const resolveLink = (url: string) => api<Resolved>(`/resolve${qs({ url })}`);

export const pathFor = (r: Resolved) => (r.type === "video" ? paths.watch({ backend: r.backend, id: r.id }, r.start) : paths.channel({ backend: r.backend, id: r.id }));

/** Resolve a pasted link and go there; a toast says so when nothing matches. */
export async function openLink(url: string, navigate: (to: string, opts?: { replace?: boolean }) => void, service: string, replace = false) {
  try {
    navigate(pathFor(await resolveLink(url)), { replace });
  } catch {
    toast.error(`Couldn't find that on ${service}`);
  }
}

/** While the text is a link: what it points to (resolved as you type, through this server only). */
export function useLinkPreview(text: string) {
  const { backends } = useAccounts();
  const target = linkTarget(text, backends);
  const url = target?.url;
  const [state, setState] = useState<{ url: string; result: Resolved | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      resolveLink(url)
        .then((result) => !stale && setState({ url, result }))
        .catch(() => !stale && setState({ url, result: null }));
    }, 200);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [url]);
  if (!target) return null;
  const done = state?.url === url ? state : null;
  return { url: target.url, service: backendName(target.backend), loading: !done, result: done?.result ?? null };
}
