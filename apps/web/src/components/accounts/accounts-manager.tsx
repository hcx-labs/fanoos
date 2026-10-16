import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, RefreshCw, Server, Star, Trash2, TriangleAlert, UserPlus, Zap } from "lucide-react";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { ConnectAccount } from "@/components/accounts/connect-account";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { accountActions, useAccounts } from "@/lib/session";
import type { Backend, LinkedAccount } from "@/lib/types";

type Editing = { type: "backend"; backend: Backend } | { type: "account"; account: LinkedAccount } | null;

const failed = (action: string) => (error: unknown) => toast.error(`Couldn't ${action}`, { description: (error as Error).message });

export function AccountsManager() {
  const { backends, accounts, active } = useAccounts();
  const [adding, setAdding] = useState<{ backendId?: string } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="space-y-4">
      {backends.map((backend) => {
        const list = accounts.filter((a) => a.backendId === backend.id);
        return (
          <section key={backend.id} className="bg-card overflow-hidden rounded-2xl border" aria-label={backend.label}>
            <header className="bg-muted/40 flex items-center gap-3 border-b px-4 py-3">
              <span className="bg-background grid size-9 place-items-center rounded-lg border">
                <Server className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {backend.label}
                  <Badge variant="outline" className="text-[10px]">
                    YouTube
                  </Badge>
                </p>
                <p className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
                  <span className="bg-like size-1.5 rounded-full" aria-hidden />
                  {backend.url.replace(/^https?:\/\//, "")}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setAdding({ backendId: backend.id })}>
                <UserPlus /> <span className="hidden sm:inline">Link account</span>
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Rename ${backend.label}`} onClick={() => setEditing({ type: "backend", backend })}>
                <Pencil />
              </Button>
            </header>

            {list.length === 0 ? (
              <p className="text-muted-foreground p-4 text-sm">No linked accounts on this backend yet.</p>
            ) : (
              <ul className="divide-y">
                {list.map((account) => (
                  <li key={account.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                    <AccountAvatar account={account} className="size-10" textClassName="text-xs" />
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {account.label}
                        {active?.id === account.id && (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <Star className="fill-current" /> Default
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          title={account.canWrite ? "Can subscribe, like and comment" : "Can read subscriptions and playlists only"}
                        >
                          {account.canWrite ? "Can act" : "Read-only"}
                        </Badge>
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {account.name} · {account.email}
                      </p>
                    </div>
                    {!account.needsRelink && !account.canWrite && (
                      <Button variant="outline" size="sm" onClick={() => accountActions.link(account.backendId, "settings", { write: true, accountId: account.id })}>
                        <Zap /> Allow actions
                      </Button>
                    )}
                    {account.needsRelink ? (
                      <Button variant="outline" size="sm" onClick={() => accountActions.link(account.backendId)}>
                        <TriangleAlert className="text-brand-strong" /> Link again
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`feed-${account.id}`}
                          size="sm"
                          checked={account.inFeed}
                          onCheckedChange={(on) => accountActions.update(account.id, { inFeed: on }).catch(failed("update the account"))}
                        />
                        <Label htmlFor={`feed-${account.id}`} className="text-muted-foreground text-xs font-normal">
                          In feed
                        </Label>
                      </div>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Options for ${account.label}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={active?.id === account.id} onSelect={() => accountActions.setDefault(account.id).catch(failed("change the default"))}>
                          <Star /> Make default
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing({ type: "account", account })}>
                          <Pencil /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            toast.promise(accountActions.sync(account.id), {
                              loading: "Syncing subscriptions…",
                              success: "Subscriptions synced",
                              error: (e: Error) => `Sync failed: ${e.message}`,
                            })
                          }
                        >
                          <RefreshCw /> Sync now
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            accountActions
                              .remove(account.id)
                              .then(() => toast(`Unlinked ${account.label}`, { description: "Access was revoked at Google too." }))
                              .catch(failed("unlink the account"))
                          }
                        >
                          <Trash2 /> Unlink
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <Button variant="outline" className="w-full rounded-2xl border-dashed py-6" onClick={() => setAdding({})}>
        <Plus /> Link an account
      </Button>

      <Dialog open={adding !== null} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link an account</DialogTitle>
            <DialogDescription>You'll sign in on Google's page, then come back here.</DialogDescription>
          </DialogHeader>
          {adding && <ConnectAccount backendId={adding.backendId} />}
        </DialogContent>
      </Dialog>

      <RenameDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RenameDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [seen, setSeen] = useState<Editing>(null);
  // Reset the field when a different item opens.
  if (editing !== seen) {
    setSeen(editing);
    setLabel(editing?.type === "backend" ? editing.backend.label : editing?.type === "account" ? editing.account.label : "");
  }

  const save = () => {
    const value = label.trim();
    if (value && editing?.type === "backend") accountActions.renameBackend(editing.backend.id, value).catch(failed("rename the backend"));
    if (value && editing?.type === "account") accountActions.update(editing.account.id, { label: value }).catch(failed("rename the account"));
    onClose();
  };

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{editing?.type === "backend" ? "Rename backend" : "Rename account"}</DialogTitle>
            <DialogDescription>Only you see this name. It labels the {editing?.type ?? "item"} across the app.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit-label">Name</Label>
            <Input id="edit-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
