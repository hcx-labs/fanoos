import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import type { AgeRestrictedSetup as State } from "@/lib/types";

/**
 * Server-wide signed-in playback for age-restricted videos (owner only). The server
 * starts a second streaming service and Google's device sign-in hands us a code;
 * everything else keeps streaming signed out.
 */
export function AgeRestrictedSetup() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Poll while something is in progress.
  useEffect(() => {
    let live = true;
    const load = () => api<State>("/admin/b/youtube/age-restricted").then((s) => live && setState(s), () => {});
    void load();
    const timer = window.setInterval(() => {
      if (state?.status === "starting" || state?.status === "waiting") void load();
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
          <Button variant="ghost" size="sm" onClick={() => void run("/admin/b/youtube/age-restricted/sign-out", "Sign-in cancelled")} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}

      {state.status === "external" && (
        <div className="space-y-3 text-sm">
          <p>
            In Docker, signed-in playback runs as its own container, <code className="bg-muted rounded px-1 py-0.5 text-xs">companion-signed-in</code>. Start it
            next to <code className="bg-muted rounded px-1 py-0.5 text-xs">compose.yaml</code>:
          </p>
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">docker compose --profile age-restricted up -d companion-signed-in{"\n"}docker compose logs -f companion-signed-in</pre>
          <p className="text-muted-foreground text-xs">
            On first start its log shows a code to enter at google.com/device. Sign in there with a secondary Google account; once the log says it started,
            come back and check again. The sign-in is kept in the container's volume.
          </p>
          <Button onClick={() => void run("/admin/b/youtube/age-restricted/start")} disabled={busy}>
            {busy && <Spinner />} Check again
          </Button>
        </div>
      )}

      {state.status === "ready" && state.external && (
        <p className="flex items-start gap-2 text-sm">
          <Check className="text-like mt-0.5 size-4 shrink-0" />
          <span>
            Signed in. Age-restricted videos now play through this account. To sign out, stop <code className="bg-muted rounded px-1 py-0.5 text-xs">companion-signed-in</code> and
            remove its volume (<code className="bg-muted rounded px-1 py-0.5 text-xs">docker compose --profile age-restricted down -v companion-signed-in</code>).
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
