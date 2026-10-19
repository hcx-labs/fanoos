import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import type { AgeRestrictedSetup as State } from "@/lib/types";

/**
 * Server-wide signed-in playback (owner only): a second streaming service signed in to a
 * secondary Google account, used for age-restricted videos and, if the owner allows, videos
 * YouTube blocks with its bot check. Everything else keeps streaming signed out.
 */
export function AgeRestrictedSetup() {
  const [state, setState] = useState<State | null>(null);
  const [fallback, setFallback] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ botCheckFallback: boolean }>("/admin/b/youtube/age-restricted/settings").then((s) => setFallback(s.botCheckFallback), () => {});
  }, []);
  const saveFallback = async (on: boolean) => {
    setFallback(on);
    try {
      setFallback((await api<{ botCheckFallback: boolean }>("/admin/b/youtube/age-restricted/settings", { method: "PUT", body: { botCheckFallback: on } })).botCheckFallback);
    } catch (e) {
      setFallback(!on);
      toast.error("Couldn't save that", { description: (e as Error).message });
    }
  };
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Poll while something is in progress.
  useEffect(() => {
    let live = true;
    const load = () => api<State>("/admin/b/youtube/age-restricted").then((s) => live && setState(s), () => {});
    void load();
    const timer = window.setInterval(() => {
      if (state?.status === "starting" || state?.status === "waiting" || state?.status === "external") void load();
    }, 2500);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [state?.status]);

  const run = async (path: string, done?: string) => {
    setBusy(true);
    try {
      setState(await api<State>(path, { body: {} }));
      if (done) toast(done);
    } catch (e) {
      toast.error("Something went wrong", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <div className="p-4"><Spinner className="text-muted-foreground" /></div>;

  const signedIn = state.status === "ready";
  return (
    <div className="space-y-4 p-4">
      {state.status === "off" && (
        <>
          <p className="text-sm">
            YouTube only streams age-restricted videos to signed-in, 18+ accounts. Sign in a Google account here and the server uses it
            <span className="font-medium"> only for those videos</span>; everything else stays signed out.
          </p>
          <p className="text-muted-foreground flex gap-2 text-xs">
            <ShieldAlert className="text-brand-strong mt-0.5 size-3.5 shrink-0" />
            Use a secondary account. Google sees that account play age-restricted videos, and unofficial clients carry some risk of restrictions.
          </p>
          <Button onClick={() => void run("/admin/b/youtube/age-restricted/start")} disabled={busy}>
            {busy && <Spinner />} Sign in with Google
          </Button>
        </>
      )}

      {state.status === "starting" && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Starting the streaming service…
        </p>
      )}

      {state.status === "waiting" && (
        <div className="space-y-4">
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
            <li>
              Open{" "}
              <a href={state.url} target="_blank" rel="noreferrer noopener" className="text-foreground font-medium underline-offset-4 hover:underline">
                {state.url.replace(/^https?:\/\/(www\.)?/, "")}
              </a>{" "}
              on any device.
            </li>
            <li>Enter this code and choose the account to use.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <code className="bg-muted rounded-xl px-4 py-2.5 font-mono text-2xl font-semibold tracking-[0.2em]">{state.code}</code>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(state.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy code"}
            </Button>
            <Button variant="outline" asChild>
              <a href={state.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink /> Open Google
              </a>
            </Button>
          </div>
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Spinner className="size-3" /> Waiting for you to approve… this page updates by itself.
          </p>
          {!state.external && (
            <Button variant="ghost" size="sm" onClick={() => void run("/admin/b/youtube/age-restricted/sign-out", "Sign-in cancelled")} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      )}

      {state.status === "external" && (
        <div className="space-y-3 text-sm">
          <p>
            In Docker, signed-in playback runs as its own container, <code className="bg-muted rounded px-1 py-0.5 text-xs">companion-signed-in</code>. Start it
            next to <code className="bg-muted rounded px-1 py-0.5 text-xs">compose.yaml</code>:
          </p>
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">docker compose --profile age-restricted up -d companion-signed-in</pre>
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Spinner className="size-3 shrink-0" /> Waiting for it to start… the code to sign in with appears here. Use a secondary Google account; the
            sign-in is kept in the container's volume, across restarts.
          </p>
        </div>
      )}

      {state.status === "ready" && state.external && (
        <p className="flex items-start gap-2 text-sm">
          <Check className="text-like mt-0.5 size-4 shrink-0" />
          <span>
            Signed in. Age-restricted videos now play through this account. To sign out, delete the saved sign-in from its volume,{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-xs">docker run --rm -v fanoos_companion-signed-in-session:/s alpine rm /s/oauth-credentials.json</code>, then
            restart it: <code className="bg-muted rounded px-1 py-0.5 text-xs">docker compose restart companion-signed-in</code>. A new code then appears here.
          </span>
        </p>
      )}

      {state.status === "ready" && !state.external && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex flex-1 items-center gap-2 text-sm">
            <Check className="text-like size-4" /> Signed in. Age-restricted videos now play through this account.
          </p>
          <Button variant="outline" onClick={() => void run("/admin/b/youtube/age-restricted/sign-out", "Signed out of age-restricted playback")} disabled={busy}>
            <LogOut /> Sign out
          </Button>
        </div>
      )}

      {fallback !== null && (
        <Label htmlFor="bot-fallback" className="hover:bg-muted/60 flex items-start gap-3 rounded-xl border p-3 font-normal">
          <Switch id="bot-fallback" className="mt-0.5" checked={fallback} onCheckedChange={(on) => void saveFallback(on)} />
          <span>
            <span className="block text-sm font-medium">Also when YouTube asks to confirm you're not a bot</span>
            <span className="text-muted-foreground block text-xs">
              If YouTube distrusts this server's address, play those videos through the signed-in account too. Everything else stays signed out.
              {!signedIn && " Needs the account above to be signed in."}
            </span>
          </span>
        </Label>
      )}

      {state.status === "error" && (
        <div className="space-y-3">
          <p className="text-destructive text-sm">{state.error}</p>
          <Button onClick={() => void run("/admin/b/youtube/age-restricted/start")} disabled={busy}>
            {busy && <Spinner />} Try again
          </Button>
        </div>
      )}
    </div>
  );
}
