import { ChannelAvatar } from "@/components/channel-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hueFor } from "@/lib/format";
import { useAccounts } from "@/lib/session";
import type { LinkedAccount } from "@/lib/types";
import { cn } from "@/lib/utils";

/** An account's avatar: initials of its nickname, tinted by its id so same-named accounts differ. */
export function AccountAvatar({ account, className, textClassName }: { account: LinkedAccount; className?: string; textClassName?: string }) {
  return <ChannelAvatar name={account.label} src={account.avatar} hueKey={account.id} className={className} textClassName={textClassName} />;
}

export const accountColor = (account: Pick<LinkedAccount, "id">) => `oklch(0.72 0.14 ${hueFor(account.id)})`;

/**
 * Small coloured dots for the accounts an item came through. Shown only when the viewer has
 * several feed accounts on the item's own service; otherwise the service mark says it all.
 */
export function ViaDots({ via, className }: { via?: string[]; className?: string }) {
  const { inFeed, byId } = useAccounts();
  const accounts = (via ?? []).map(byId).filter((a): a is LinkedAccount => !!a);
  const backendId = accounts[0]?.backendId;
  if (!accounts.length || inFeed.filter((a) => a.backendId === backendId).length < 2) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center -space-x-0.5 align-middle", className)} aria-label={`From ${accounts.map((a) => a.label).join(", ")}`}>
          {accounts.map((a) => (
            <span key={a.id} className="ring-background size-2 rounded-full ring-2" style={{ background: accountColor(a) }} />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>From {accounts.map((a) => a.label).join(" and ")}</TooltipContent>
    </Tooltip>
  );
}
