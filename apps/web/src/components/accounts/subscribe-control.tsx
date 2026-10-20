import { useEffect, useState } from "react";
import { Check, ChevronDown, ExternalLink, Zap } from "lucide-react";
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
 * Following state for every account linked on this channel's backend, and follow/unfollow
 * (subscribe, add to watchlist…) for the accounts that allow actions. Read-only accounts
 * show their state only. Wording comes from the backend.
 */
export function SubscribeControl({ channel }: { channel: Channel }) {
  const { accounts: everyAccount, bySlug } = useAccounts();
  const backend = bySlug(channel.backend);
  const accounts = everyAccount.filter((a) => a.backendId === backend?.id);
  const nouns = backend?.info?.nouns ?? { follow: "Subscribe", following: "Subscribed" };
  const canFollow = backend?.info?.features.includes("follow") ?? false;
  const source = useSource();
  const state = useData(() => source.followers(channel), [source.key, channel.backend, channel.id]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (state.data) setFollowing(new Set(state.data));
  }, [state.data]);

  if (!accounts.length || !backend) return null;

  const followers = accounts.filter((a) => following.has(a.id));
  const subscribed = followers.length > 0;
  const summary = subscribed ? `${nouns.following} with ${followers.map((a) => a.label).join(", ")}` : `Not ${nouns.following.toLowerCase()} with any linked account`;

  const toggle = async (accountId: string, label: string) => {
    const on = !following.has(accountId);
    setBusy(accountId);
    try {
      await source.follow(accountId, channel.id, on);
      setFollowing((current) => {
        const next = new Set(current);
        if (on) next.add(accountId);
        else next.delete(accountId);
        return next;
      });
      toast.success(on ? `${nouns.following} as ${label}` : `Removed for ${label}`, { description: channel.name });
    } catch (e) {
      toast.error(on ? `Couldn't ${nouns.follow.toLowerCase()}` : "Couldn't undo that", { description: (e as Error).message });
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
          {subscribed ? nouns.following : nouns.follow}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{nouns.follow} with</DropdownMenuLabel>
        {(() => {
          const list = accounts;
          return (
            <DropdownMenuGroup>
              {list.map((account) =>
                account.canWrite && canFollow ? (
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
                  <DropdownMenuItem key={account.id} onSelect={(event) => event.preventDefault()} className="gap-2">
                    <AccountAvatar account={account} className="size-5" textClassName="text-[9px]" />
                    <span className="flex-1 truncate">{account.label}</span>
                    {following.has(account.id) ? <Check className="text-like size-4" aria-label="Subscribed" /> : <span className="text-muted-foreground text-xs">—</span>}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuGroup>
          );
        })()}
        {accounts.some((a) => !a.canWrite) && backend.info?.link.writeOption && <DropdownMenuSeparator />}
        {accounts
          .filter((a) => !a.canWrite && !a.needsRelink && backend.info?.link.writeOption)
          .map((a) => (
            <DropdownMenuItem key={a.id} onSelect={() => void accountActions.link(a.backendId, "settings", { write: true, accountId: a.id })}>
              <Zap /> Allow actions for {a.label}
            </DropdownMenuItem>
          ))}
        {(channel.url || backend.info?.urls.channel) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={channel.url || backend.info?.urls.channel.replace("{id}", encodeURIComponent(channel.id))} target="_blank" rel="noreferrer noopener">
                <ExternalLink /> Open on {backend.info?.name ?? backend.slug}
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
