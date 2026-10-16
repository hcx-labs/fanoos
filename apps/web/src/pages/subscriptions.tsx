import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Download, ExternalLink, Eye, EyeOff, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useData } from "@/hooks/use-data";
import { useSource } from "@/lib/source";
import { accountActions, useAccounts } from "@/lib/session";
import { actions, useStore } from "@/lib/store";
import type { Channel, LinkedAccount } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/use-title";

export function SubscriptionsPage() {
  useTitle("Your channels");
  const source = useSource();
  const { inFeed } = useAccounts();
  const [reload, setReload] = useState(0);
  const state = useData(() => source.subscriptions(), [source.key, reload]);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const groups = useMemo(
    () => [...new Set((state.data ?? []).map((c) => (c.id in overrides ? overrides[c.id] : c.group)).filter((g): g is string => Boolean(g)))].sort(),
    [state.data, overrides],
  );
  const muted = useStore((s) => s.muted);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");

  const channels = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.data
      .map((c) => ({ ...c, group: c.id in overrides ? (overrides[c.id] ?? undefined) : c.group }))
      .filter((c) => (group === "all" || c.group === group) && c.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state, query, group, overrides]);

  return (
    <div className="relative">
      <div className="page relative">
        <header className="flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <h1 className="font-display text-3xl font-semibold sm:text-4xl">Your channels</h1>
            <p className="text-muted-foreground mt-2 max-w-xl">
              Every channel from your {inFeed.length} feed {inFeed.length === 1 ? "account" : "accounts"}, merged into one list. Group them, hide the noisy ones, or
              export everything — your feed is built only from this list.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() =>
                toast.promise(Promise.all(inFeed.map((a) => accountActions.sync(a.id))).then(() => setReload((n) => n + 1)), {
                  loading: "Syncing with YouTube…",
                  success: "Subscriptions synced",
                  error: (e: Error) => `Sync failed: ${e.message}`,
                })
              }
            >
              <RefreshCw /> Sync now
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-full" disabled={!state.data?.length}>
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Take your subscriptions anywhere</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => download("subscriptions.opml", opml(state.data ?? []), "text/x-opml")}>
                  <Download /> OPML (feed readers, FreeTube)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    download(
                      "newpipe-subscriptions.json",
                      JSON.stringify({ app_version: "0.24.0", app_version_int: 990, subscriptions: (state.data ?? []).map((c) => ({ service_id: 0, url: `https://www.youtube.com/channel/${c.id}`, name: c.name })) }, null, 2),
                      "application/json",
                    )
                  }
                >
                  <Download /> NewPipe JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <InputGroup className="h-9 w-full max-w-xs rounded-full">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter channels" aria-label="Filter channels" />
          </InputGroup>
          <ToggleGroup type="single" value={group} onValueChange={(v) => v && setGroup(v)} spacing={1} className="no-scrollbar max-w-full overflow-x-auto">
            {["all", ...groups].map((g) => (
              <ToggleGroupItem
                key={g}
                value={g}
                className="data-[state=on]:bg-foreground data-[state=on]:text-background bg-secondary h-8 rounded-full px-4 text-[13px]"
              >
                {g === "all" ? "All" : g}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.status === "loading" &&
            Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          {channels.map((channel) => (
            <ChannelTile
              key={channel.id}
              channel={channel}
              muted={muted.includes(channel.id)}
              groups={groups}
              onGroup={(g) => {
                setOverrides((o) => ({ ...o, [channel.id]: g }));
                source.setGroup(channel.id, g).catch((e: Error) => toast.error("Couldn't save the group", { description: e.message }));
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChannelTile({ channel, muted, groups, onGroup }: { channel: Channel; muted: boolean; groups: string[]; onGroup: (group: string | null) => void }) {
  const { byId } = useAccounts();
  const via = (channel.via ?? []).map(byId).filter((a): a is LinkedAccount => a !== undefined);
  return (
    <article className={cn("bg-card group relative flex flex-col gap-4 rounded-2xl border p-4 transition-colors", muted && "opacity-60")}>
      <div className="flex items-start gap-3">
        <ChannelAvatar name={channel.name} src={channel.avatar} ring={channel.unseen > 0} className="size-12" textClassName="text-sm" />
        <div className="min-w-0 flex-1">
          <Link to={`/channel/${channel.id}`} className="block truncate font-semibold after:absolute after:inset-0 hover:underline">
            {channel.name}
          </Link>
          <p className="text-muted-foreground truncate text-xs">
            {channel.unseen > 0 ? `${channel.unseen} new in 48h` : "No new videos"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Options for ${channel.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => actions.toggleMute(channel.id)}>
              {muted ? <Eye /> : <EyeOff />}
              {muted ? "Show in feed" : "Hide from feed"}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={channel.group ?? ""} onValueChange={(g) => onGroup(g || null)}>
                  {[...new Set([...groups, ...suggestedGroups])].sort().map((g) => (
                    <DropdownMenuRadioItem key={g} value={g}>
                      {g}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioItem value="">No group</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer noopener">
                <ExternalLink /> Manage on YouTube
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
            <div className="mt-auto flex items-center gap-2">
        {channel.group && <Badge variant="secondary">{channel.group}</Badge>}
        {muted && <Badge variant="outline">Hidden</Badge>}
        <span className="ml-auto flex -space-x-1.5" title={`Subscribed with ${via.map((a) => a.label).join(", ")}`}>
          {via.map((a) => (
            <AccountAvatar key={a.id} account={a} className="ring-card size-6 ring-2" textClassName="text-[9px]" />
          ))}
        </span>
      </div>
    </article>
  );
}

const suggestedGroups = ["Tech", "Science", "Learning", "Music", "Gaming", "News", "Entertainment"];

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function opml(channels: Channel[]) {
  const outlines = channels
    .map((c) => `      <outline text="${escapeXml(c.name)}" title="${escapeXml(c.name)}" type="rss" xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=${c.id}" />`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="1.1">\n  <body>\n    <outline text="YouTube Subscriptions" title="YouTube Subscriptions">\n${outlines}\n    </outline>\n  </body>\n</opml>\n`;
}
