import { Check, ChevronDown, ExternalLink, Server } from "lucide-react";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useData } from "@/hooks/use-data";
import { useAccounts } from "@/lib/session";
import { useSource } from "@/lib/source";
import type { Channel } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Which linked accounts follow this channel. Access is read-only for now, so
 * changing subscriptions happens on YouTube; this shows the state per account.
 */
export function SubscribeControl({ channel }: { channel: Channel }) {
  const { accounts, backends } = useAccounts();
  const source = useSource();
  const state = useData(() => source.subscribers(channel), [source.key, channel.id]);
  if (!accounts.length) return null;

  const following = new Set(state.data ?? []);
  const followers = accounts.filter((a) => following.has(a.id));
  const subscribed = followers.length > 0;
  const summary = subscribed ? `Subscribed with ${followers.map((a) => a.label).join(", ")}` : "Not subscribed with any linked account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
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
          {subscribed ? "Subscribed" : "Not subscribed"}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your accounts</DropdownMenuLabel>
        {backends.map((backend) => {
          const list = accounts.filter((a) => a.backendId === backend.id);
          if (!list.length) return null;
          return (
            <DropdownMenuGroup key={backend.id}>
              <DropdownMenuLabel className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
                <Server className="size-3" /> {backend.label}
              </DropdownMenuLabel>
              {list.map((account) => (
                <div key={account.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <AccountAvatar account={account} className="size-5" textClassName="text-[9px]" />
                  <span className="flex-1 truncate">{account.label}</span>
                  {following.has(account.id) ? (
                    <Check className="text-like size-4" aria-label="Subscribed" />
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </div>
              ))}
            </DropdownMenuGroup>
          );
        })}
        <DropdownMenuSeparator />
        <p className="text-muted-foreground px-2 py-1.5 text-xs">Access is read-only for now, so subscribe or unsubscribe on YouTube.</p>
        <DropdownMenuItem asChild>
          <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Open on YouTube
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
