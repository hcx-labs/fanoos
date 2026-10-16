import { useState } from "react";
import { Check, Lock, Plus, Server, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { accountActions, useAccounts } from "@/lib/session";
import { cn } from "@/lib/utils";

const read = ["See your subscriptions", "See your playlists", "See basic profile info"];
const write = ["Subscribe and unsubscribe", "Like and dislike", "Comment and reply"];

/**
 * Pick a backend, then sign in with Google through it. Sign-in happens on Google's
 * page; the server stores the token and sends the browser back here.
 */
export function ConnectAccount({ backendId: fixedBackend, returnTo = "settings" }: { backendId?: string; returnTo?: "home" | "settings" }) {
  const { backends, accounts, googleConfigured } = useAccounts();
  const [choice, setChoice] = useState(fixedBackend ?? backends[0]?.id ?? "");
  const [leaving, setLeaving] = useState(false);
  const [actions, setActions] = useState(true);
  const can = actions ? [...read, ...write] : read;
  const cannot = actions
    ? ["See your watch history", "Upload or change your account", "Act without you pressing a button"]
    : ["Subscribe, like or comment as you", "See your watch history", "Change your account"];

  return (
    <div className="space-y-5">
      {!fixedBackend && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Backend</legend>
          <RadioGroup value={choice} onValueChange={setChoice} className="gap-2">
            {backends.map((b) => (
              <Label
                key={b.id}
                htmlFor={`bk-${b.id}`}
                className={cn("hover:bg-muted/60 flex items-center gap-3 rounded-xl border p-3 font-normal", choice === b.id && "border-brand bg-brand-soft/40")}
              >
                <RadioGroupItem id={`bk-${b.id}`} value={b.id} />
                <Server className="text-muted-foreground size-4" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{b.label}</span>
                  <span className="text-muted-foreground block truncate text-xs">YouTube · {b.url.replace(/^https?:\/\//, "")}</span>
                </span>
                <span className="text-muted-foreground text-xs">{accounts.filter((a) => a.backendId === b.id).length} linked</span>
              </Label>
            ))}
          </RadioGroup>
          <p className="text-muted-foreground flex items-center gap-2 rounded-xl border border-dashed p-3 text-xs">
            <Plus className="size-4" /> Linking through another server is coming later. For now, every account links through this one.
          </p>
        </fieldset>
      )}

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
            {cannot.map((t) => (
              <li key={t} className="text-muted-foreground flex items-center gap-2">
                <X className="text-dislike size-4 shrink-0" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Label htmlFor="allow-actions" className="hover:bg-muted/60 flex items-start gap-3 rounded-xl border p-3 font-normal">
        <Checkbox id="allow-actions" checked={actions} onCheckedChange={(on) => setActions(on === true)} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium">Allow subscribing, liking and commenting</span>
          <span className="text-muted-foreground block text-xs">
            Adds YouTube’s “manage your account” permission. Leave it off to link read-only; you can allow it later.
          </span>
        </span>
      </Label>

      {googleConfigured ? (
        <Button
          size="lg"
          className="h-11 w-full rounded-xl text-base"
          disabled={!choice || leaving}
          onClick={() => {
            setLeaving(true);
            accountActions.link(choice, returnTo, { write: actions });
          }}
        >
          <Lock /> Continue with Google
        </Button>
      ) : (
        <div className="bg-muted/60 flex gap-3 rounded-xl p-4 text-sm">
          <TriangleAlert className="text-brand-strong mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Google sign-in isn't set up on this server yet</p>
            <p className="text-muted-foreground mt-1 text-xs">
              The server owner needs to add a Google OAuth client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). Search and playback work without it.
            </p>
          </div>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Tokens are encrypted on the server, never stored in this browser, and you can revoke them any time from your Google account.
      </p>
    </div>
  );
}
