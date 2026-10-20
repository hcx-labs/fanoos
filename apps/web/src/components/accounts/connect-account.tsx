import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Eye, Lock, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { accountActions, backendName, useAccounts, type DeviceLink } from "@/lib/session";
import type { Backend } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Link an account on one of the server's services. What each service can and can't do, and how
 * sign-in works (the service's own page, or a code entered on its site), comes from its backend.
 */
export function ConnectAccount({
  backendId: fixedBackend,
  returnTo = "settings",
  onLinked,
  relink,
}: {
  backendId?: string;
  returnTo?: "home" | "settings";
  onLinked?: (accountId: string) => void;
  /** Link this existing account again (or upgrade it) instead of adding one. */
  relink?: { accountId: string; write: boolean };
}) {
  const { backends, accounts } = useAccounts();
  const available = backends.filter((b) => b.info);
  const [choice, setChoice] = useState(fixedBackend ?? available[0]?.id ?? "");
  const backend = backends.find((b) => b.id === choice);

  return (
    <div className="space-y-5">
      {!fixedBackend && available.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Service</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {available.map((b) => {
              const linked = accounts.filter((a) => a.backendId === b.id).length;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={choice === b.id}
                  onClick={() => setChoice(b.id)}
                  className={cn(
                    "hover:bg-muted/60 flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                    choice === b.id && "border-foreground bg-card ring-foreground/10 ring-4",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: b.info!.color }}>
                    {b.info!.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{b.info!.name}</span>
                    <span className="text-muted-foreground block text-xs">{linked ? `${linked} linked` : b.info!.link.method === "device" ? "Sign in with a code" : `Sign in with ${b.info!.kind === "youtube" ? "Google" : b.info!.name}`}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {backend?.info ? <LinkPanel key={backend.id} backend={backend} returnTo={returnTo} onLinked={onLinked} relink={relink} /> : <p className="text-muted-foreground text-sm">No services are reachable right now.</p>}
    </div>
  );
}

function LinkPanel({
  backend,
  returnTo,
  onLinked,
  relink,
}: {
  backend: Backend;
  returnTo: "home" | "settings";
  onLinked?: (accountId: string) => void;
  relink?: { accountId: string; write: boolean };
}) {
  const info = backend.info!;
  const [actions, setActions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<DeviceLink | null>(null);
  const write = info.link.writeOption && actions;
  const can = write ? [...info.link.can, ...info.link.writeOption!.can] : info.link.can;

  const start = async () => {
    setBusy(true);
    try {
      const next = await accountActions.link(backend.id, returnTo, { write: Boolean(write) || relink?.write, accountId: relink?.accountId });
      // Redirect flows have left the page by now; device flows show their code.
      if (next) setDevice(next);
    } catch (e) {
      toast.error(`Couldn't start linking ${info.name}`, { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (device) return <DeviceCode backend={backend} link={device} onDone={(id) => (setDevice(null), onLinked?.(id))} onRetry={() => void start()} onCancel={() => setDevice(null)} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium">The server can</p>
          <ul className="space-y-1.5">
            {can.map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check className="text-like size-4 shrink-0" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium">It can't</p>
          <ul className="space-y-1.5">
            {info.link.cannot.map((t) => (
              <li key={t} className="text-muted-foreground flex items-center gap-2">
                <X className="text-dislike size-4 shrink-0" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!info.private && (
        <div className="bg-muted/60 flex gap-3 rounded-xl p-3 text-sm">
          <Eye className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-xs">
            {info.name} only works signed in, so it sees what you watch there and keeps it in your {info.name} history. Your other services stay private.
          </p>
        </div>
      )}

      {info.link.writeOption && (
        <Label htmlFor="allow-actions" className="hover:bg-muted/60 flex items-start gap-3 rounded-xl border p-3 font-normal">
          <Checkbox id="allow-actions" checked={actions} onCheckedChange={(on) => setActions(on === true)} className="mt-0.5" />
          <span>
            <span className="block text-sm font-medium">{info.link.writeOption.label}</span>
            <span className="text-muted-foreground block text-xs">{info.link.writeOption.description}</span>
          </span>
        </Label>
      )}

      {info.link.configured ? (
        <Button size="lg" className="h-11 w-full rounded-xl text-base" disabled={busy} onClick={() => void start()}>
          {busy ? <Spinner /> : <Lock />} {info.link.method === "device" ? `Get a code for ${info.name}` : `Continue with ${info.kind === "youtube" ? "Google" : info.name}`}
        </Button>
      ) : (
        <div className="bg-muted/60 flex gap-3 rounded-xl p-4 text-sm">
          <TriangleAlert className="text-brand-strong mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{info.name} sign-in isn't set up on this server yet</p>
            <p className="text-muted-foreground mt-1 text-xs">The server owner needs to add the {info.name} backend's credentials (see its .env).</p>
          </div>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {info.link.requirement ? `${info.link.requirement} ` : ""}
        Credentials are encrypted on the {info.name} backend, never stored in this browser, and you can unlink any time.
      </p>
    </div>
  );
}

/** The code to enter on the service's site, while the app waits for it to be accepted. */
function DeviceCode({
  backend,
  link,
  onDone,
  onRetry,
  onCancel,
}: {
  backend: Backend;
  link: DeviceLink;
  onDone: (accountId: string) => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const name = backendName(backend);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [left, setLeft] = useState(link.expiresIn);
  const [copied, setCopied] = useState(false);
  const opened = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    accountActions
      .waitForLink(link, controller.signal)
      .then(({ accountId }) => {
        toast.success(`${name} account linked`);
        onDone(accountId);
      })
      .catch((e: Error & { code?: string }) => {
        if (e.code !== "cancelled") setError({ message: e.message, code: e.code });
      });
    const timer = window.setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  const verify = new URL(link.verifyUrl);

  return (
    <div className="space-y-5 text-center">
      {error ? (
        <div className="space-y-3">
          <p className="font-semibold">{error.code === "not_premium" ? `${name} Premium needed` : "That didn't work"}</p>
          <p className="text-muted-foreground text-sm">{error.message}</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Back
            </Button>
            <Button onClick={onRetry}>Get a new code</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Go to <span className="text-foreground font-medium">{verify.host + verify.pathname}</span>, signed in to {name}, and enter:
          </p>
          <button
            type="button"
            className="group bg-muted/60 hover:bg-muted mx-auto flex items-center gap-3 rounded-2xl border px-6 py-4"
            onClick={() => {
              void navigator.clipboard?.writeText(link.code).then(() => setCopied(true));
            }}
            aria-label={`Code ${link.code.split("").join(" ")}. Copy`}
          >
            <span className="font-mono text-4xl font-semibold tracking-[0.3em] tabular-nums">{link.code}</span>
            {copied ? <Check className="text-like size-5" /> : <Copy className="text-muted-foreground size-5 opacity-0 group-hover:opacity-100" />}
          </button>
          <Button
            size="lg"
            className="h-11 w-full rounded-xl text-base"
            onClick={() => {
              opened.current = true;
              window.open(link.verifyUrl, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink /> Open {verify.host.replace(/^www\./, "")}
          </Button>
          <p className="text-muted-foreground flex items-center justify-center gap-2 text-xs" aria-live="polite">
            <Spinner className="size-3.5" /> Waiting for {name}… the code works for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </p>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
