import { useEffect, useState } from "react";
import { Check, ChevronDown, ExternalLink, Server, Zap } from "lucide-react";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useData } from "@/hooks/use-data";
import { accountActions, useAccounts } from "@/lib/session";
import { useSource } from "@/lib/source";
import type { Channel } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Subscription state for every linked account, and subscribe/unsubscribe for the
 * accounts that allow actions. Read-only accounts show their state only.
 */
export function SubscribeControl({ channel }: { channel: Channel }) {
  const { accounts, backends } = useAccounts();
  const source = useSource();
  const state = useData(() => source.subscribers(channel), [source.key, channel.id]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (state.data) setFollowing(new Set(state.data));
  }, [state.data]);

  if (!accounts.length) return null;

  const followers = accounts.filter((a) => following.has(a.id));
  const subscribed = followers.length > 0;
  const summary = subscribed ? `Subscribed with ${followers.map((a) => a.label).join(", ")}` : "Not subscribed with any linked account";

  const toggle = async (accountId: string, label: string) => {
    const on = !following.has(accountId);
    setBusy(accountId);
    try {
      await source.setSubscribed(accountId, channel.id, on);
      setFollowing((current) => {
        const next = new Set(current);
        if (on) next.add(accountId);
        else next.delete(accountId);
        return next;
      });
      toast.success(on ? `Subscribed as ${label}` : `Unsubscribed ${label}`, { description: channel.name });
    } catch (e) {
      toast.error(on ? "Couldn't subscribe" : "Couldn't unsubscribe", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={subscribed ? "secondary" : "default"}
          className={cn("rounded-full pr-3", subscribed ? "pl-2" : "pl-4")}
          disabled={state.status === "loading"}
          aria-label={summary}
          title={summary}
        >
          {subscribed && (
            <span className="flex -space-x-1.5">
              {followers.slice(0, 3).map((a) => (
                <AccountAvatar key={a.id} account={a} className="ring-secondary size-5 ring-2" textClassName="text-[9px]" />
              ))}
            </span>
          )}
          {busy ? <Spinner /> : null}
          {subscribed ? "Subscribed" : "Subscribe"}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Subscribe with</DropdownMenuLabel>
        {backends.map((backend) => {
          const list = accounts.filter((a) => a.backendId === backend.id);
          if (!list.length) return null;
          return (
            <DropdownMenuGroup key={backend.id}>
              <DropdownMenuLabel className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
                <Server className="size-3" /> {backend.label}
              </DropdownMenuLabel>
              {list.map((account) =>
                account.canWrite ? (
                  <DropdownMenuCheckboxItem
                    key={account.id}
                    checked={following.has(account.id)}
                    disabled={busy !== null}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => void toggle(account.id, account.label)}
                  >
                    <AccountAvatar account={account} className="size-5" textClassName="text-[9px]" />
                    <span className="flex-1 truncate">{account.label}</span>
                    {busy === account.id && <Spinner className="size-3" />}
                  </DropdownMenuCheckboxItem>
                ) : (
                  <div key={account.id} className="flex items-center gap-2 py-1.5 pr-2 pl-8 text-sm" title="Read-only account">
                    <AccountAvatar account={account} className="size-5" textClassName="text-[9px]" />
                    <span className="flex-1 truncate">{account.label}</span>
                    {following.has(account.id) ? <Check className="text-like size-4" aria-label="Subscribed" /> : <span className="text-muted-foreground text-xs">—</span>}
                  </div>
                ),
              )}
            </DropdownMenuGroup>
          );
        })}
        {accounts.some((a) => !a.canWrite) && <DropdownMenuSeparator />}
        {accounts
          .filter((a) => !a.canWrite && !a.needsRelink)
          .map((a) => (
            <DropdownMenuItem key={a.id} onSelect={() => accountActions.link(a.backendId, "settings", { write: true, accountId: a.id })}>
              <Zap /> Allow actions for {a.label}
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Open on YouTube
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
