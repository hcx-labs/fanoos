import { CatalogToolbar, CatalogPagination, catalogGrid } from "@/components/catalog-toolbar";
import { SectionBar } from "@/components/section-bar";
import { useCatalogPageSize } from "@/hooks/use-catalog-page-size";
import { useCursorPage } from "@/hooks/use-cursor-page";
import { api, qs } from "@/lib/api";
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
import { PageHeader, ServicePills } from "@/components/page-header";
import { ServiceMark } from "@/components/service-mark";
import { itemKey, paths } from "@/lib/paths";
import { useSource } from "@/lib/source";
import { accountActions, backendName, useAccounts } from "@/lib/session";
import { actions, useStore } from "@/lib/store";
import type { Channel, LinkedAccount } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/use-title";

export function SubscriptionsPage({ kind }: { kind?: "channels" } = {}) {
  return kind ? <ChannelsPage /> : <SourcesPage />;
}

function ChannelsPage() {
  useTitle("Channels");
  const source = useSource();
  const { inFeed, feedBackends } = useAccounts();
  const youtube = feedBackends.filter((b) => b.kind === "youtube");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [service, setService] = useState("all");
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const muted = useStore((s) => s.muted);
  const pageSize = useCatalogPageSize();
  const pager = useCursorPage(JSON.stringify([source.key, revision, query, group, service, pageSize]), (next, signal) => api<{ channels: Channel[]; next?: string; total: number; groups: string[] }>(`/following${qs({ kind: "channels", backend: service === "all" ? undefined : service, limit: String(pageSize), next, q: query, group })}`, { signal }));
  const data = pager.state.data;
  const groups = data?.groups ?? [];
  const exportAll = async (format: "opml" | "newpipe") => {
    try {
      const channels = await source.following({ kind: "channels" });
      if (format === "opml") download("subscriptions.opml", opml(channels), "text/x-opml");
      else download("newpipe-subscriptions.json", JSON.stringify({ app_version: "0.24.0", app_version_int: 990, subscriptions: channels.map((c) => ({ service_id: 0, url: `https://www.youtube.com/channel/${c.id}`, name: c.name })) }, null, 2), "application/json");
    } catch (e) { toast.error("Export failed", { description: (e as Error).message }); }
  };
  const sync = () => toast.promise(Promise.all(inFeed.filter((a) => youtube.some((b) => b.id === a.backendId)).map((a) => accountActions.sync(a.id))).then(() => setRevision((n) => n + 1)), { loading: "Syncing your accounts…", success: "Synced", error: (e: Error) => e.message });
  return <div className="page">
    <PageHeader title="Channels" description="The channels you follow, across your connected accounts." actions={<><Button variant="outline" className="rounded-full" onClick={sync}><RefreshCw />Sync now</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="rounded-full" disabled={!youtube.length}><Download />Export</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Export YouTube subscriptions</DropdownMenuLabel><DropdownMenuItem onSelect={() => void exportAll("opml")}><Download />OPML (feed readers, FreeTube)</DropdownMenuItem><DropdownMenuItem onSelect={() => void exportAll("newpipe")}><Download />NewPipe JSON</DropdownMenuItem></DropdownMenuContent></DropdownMenu></>} />
    <CatalogToolbar query={query} onQuery={setQuery} label="channels"><ServicePills label="Service" value={service} onChange={setService} options={[{ value: "all", label: "Everything", count: data?.total }, ...youtube.map((b) => ({ value: b.slug, label: backendName(b), color: b.info?.color, count: data?.total }))]} /></CatalogToolbar>
    {!!groups.length && <ToggleGroup type="single" value={group} onValueChange={(v) => v && setGroup(v)} spacing={1} className="no-scrollbar mt-4 max-w-full overflow-x-auto">{["all", ...groups].map((g) => <ToggleGroupItem key={g} value={g} className="data-[state=on]:bg-foreground data-[state=on]:text-background bg-secondary h-8 rounded-full px-4 text-[13px]">{g === "all" ? "All groups" : g}</ToggleGroupItem>)}</ToggleGroup>}
    <section aria-label="Followed channels"><SectionBar className="mt-6 mb-4" title="YouTube" detail={data ? `${data.total} followed` : undefined}><CatalogPagination {...pager} loading={pager.state.status === "loading"} label="Channels" /></SectionBar>
    {pager.state.status === "loading" && <div className={catalogGrid}>{Array.from({ length: pageSize }, (_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}</div>}
    {pager.state.status === "error" && <div className="flex items-center gap-3"><p role="alert" className="text-destructive text-sm">{pager.state.error.message}</p><Button variant="outline" onClick={pager.retry}>Try again</Button></div>}
    {data && <div className={catalogGrid}>{data.channels.map((channel) => <ChannelTile key={itemKey(channel)} channel={{ ...channel, group: itemKey(channel) in overrides ? overrides[itemKey(channel)] ?? undefined : channel.group }} muted={muted.includes(itemKey(channel))} groups={groups} onGroup={(g) => { setOverrides((old) => ({ ...old, [itemKey(channel)]: g })); void source.setGroup(channel, g).catch((e: Error) => toast.error(e.message)); }} />)}</div>}
    {data && !data.channels.length && <p className="text-muted-foreground text-sm">No channels match this filter.</p>}
    </section>
  </div>;
}

function SourcesPage({ kind }: { kind?: "channels" } = {}) {
  useTitle(kind ? "Channels" : "Sources");
  const source = useSource();
  const { inFeed, feedBackends } = useAccounts();
  const [reload, setReload] = useState(0);
  const state = useData(() => source.following(), [source.key, reload]);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const keyOf = (c: Channel) => itemKey({ backend: c.backend, id: c.id });
  const groups = useMemo(
    () => [...new Set((state.data ?? []).map((c) => (keyOf(c) in overrides ? overrides[keyOf(c)] : c.group)).filter((g): g is string => Boolean(g)))].sort(),
    [state.data, overrides],
  );
  const muted = useStore((s) => s.muted);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [service, setService] = useState("all");

  const all = useMemo(
    () => (state.data ?? []).filter((channel) => !kind || !channel.kind || channel.kind === "channel").map((c) => ({ ...c, group: keyOf(c) in overrides ? (overrides[keyOf(c)] ?? undefined) : c.group })),
    [state.data, overrides, kind],
  );
  const channels = useMemo(
    () =>
      all
        .filter((c) => (service === "all" || c.backend === service) && (group === "all" || c.group === group) && c.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [all, query, group, service],
  );
  const shows = channels.filter((c) => c.kind === "series");
  const libraries = channels.filter((c) => c.kind === "library");
  const plain = channels.filter((c) => !c.kind || c.kind === "channel");
  const youtube = all.filter((c) => c.backend === "youtube");
  const setGroupFor = (channel: Channel, g: string | null) => {
    setOverrides((o) => ({ ...o, [keyOf(channel)]: g }));
    source.setGroup(channel, g).catch((e: Error) => toast.error("Couldn't save the group", { description: e.message }));
  };

  return (
    <div className="relative">
      <div className="page relative">
        <PageHeader
          title={kind ? "Channels" : "Sources"}
          description={kind ? "The channels you follow, across your connected accounts." : "Manage channels, saved shows, and server libraries across your connected accounts."}
          actions={
            <>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() =>
                toast.promise(Promise.all(inFeed.map((a) => accountActions.sync(a.id))).then(() => setReload((n) => n + 1)), {
                  loading: "Syncing your accounts…",
                  success: "Synced",
                  error: (e: Error) => `Sync failed: ${e.message}`,
                })
              }
            >
              <RefreshCw /> Sync now
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-full" disabled={!youtube.length}>
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Take your YouTube subscriptions anywhere</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => download("subscriptions.opml", opml(youtube), "text/x-opml")}>
                  <Download /> OPML (feed readers, FreeTube)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    download(
                      "newpipe-subscriptions.json",
                      JSON.stringify({ app_version: "0.24.0", app_version_int: 990, subscriptions: youtube.map((c) => ({ service_id: 0, url: `https://www.youtube.com/channel/${c.id}`, name: c.name })) }, null, 2),
                      "application/json",
                    )
                  }
                >
                  <Download /> NewPipe JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </>
          }
        />

        {feedBackends.length > 1 && (
          <ServicePills
            className="mt-8"
            label="Service"
            value={service}
            onChange={setService}
            options={[
              { value: "all", label: "Everything", count: all.length },
              ...feedBackends.map((b) => ({ value: b.slug, label: backendName(b), color: b.info?.color, count: all.filter((c) => c.backend === b.slug).length })),
            ]}
          />
        )}

        <div className={cn("flex flex-wrap items-center gap-3", feedBackends.length > 1 ? "mt-4" : "mt-8")}>
          <InputGroup className="h-9 w-full max-w-xs rounded-full">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" aria-label="Filter channels and shows" />
          </InputGroup>
{groups.length > 0 && (
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
          )}
        </div>

        {shows.length > 0 && (
          <section className="mt-8" aria-labelledby="shows">
            <h2 id="shows" className="font-display mb-4 text-xl font-semibold">
              Shows <span className="text-muted-foreground text-sm font-normal">{shows.length}</span>
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {shows.map((show) => (
                <ShowTile key={keyOf(show)} show={show} muted={muted.includes(keyOf(show))} groups={groups} onGroup={(g) => setGroupFor(show, g)} />
              ))}
            </div>
          </section>
        )}

        {libraries.length > 0 && <section className="mt-8" aria-labelledby="libraries"><h2 id="libraries" className="font-display mb-4 text-xl font-semibold">Libraries <span className="text-muted-foreground text-sm font-normal">{libraries.length}</span></h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{libraries.map((channel) => <ChannelTile key={keyOf(channel)} channel={channel} muted={muted.includes(keyOf(channel))} groups={groups} onGroup={(group) => setGroupFor(channel, group)} />)}</div></section>}
        {(plain.length > 0 || state.status === "loading") && (
          <section className="mt-8" aria-labelledby="channels">
            {(shows.length > 0 || libraries.length > 0) && (
              <h2 id="channels" className="font-display mb-4 text-xl font-semibold">
                Channels <span className="text-muted-foreground text-sm font-normal">{plain.length}</span>
              </h2>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {state.status === "loading" && Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
              {plain.map((channel) => (
                <ChannelTile key={keyOf(channel)} channel={channel} muted={muted.includes(keyOf(channel))} groups={groups} onGroup={(g) => setGroupFor(channel, g)} />
              ))}
            </div>
          </section>
        )}
        {state.status === "ready" && channels.length === 0 && <p className="text-muted-foreground mt-10 text-sm">Nothing matches.</p>}
      </div>
    </div>
  );
}

type TileProps = { muted: boolean; groups: string[]; onGroup: (group: string | null) => void };

/** Hide, group, and open-on-service actions shared by channel and show tiles. */
function TileMenu({ channel, muted, groups, onGroup, className }: TileProps & { channel: Channel; className?: string }) {
  const { bySlug } = useAccounts();
  const info = bySlug(channel.backend)?.info;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("relative z-10", className)} aria-label={`Options for ${channel.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => actions.toggleMute(itemKey({ backend: channel.backend, id: channel.id }))}>
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
        {info?.urls.channel && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={info.urls.channel.replace("{id}", encodeURIComponent(channel.id))} target="_blank" rel="noreferrer noopener">
                <ExternalLink /> Open on {info.name}
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A show: portrait key art with its name under it. */
function ShowTile({ show, ...menu }: TileProps & { show: Channel }) {
  return (
    <article className={cn("group/card relative", menu.muted && "opacity-60")}>
      <Link to={paths.channel(show)} className="block">
        <div className="bg-muted relative aspect-[2/3] overflow-hidden rounded-xl">
          {show.poster && <img src={show.poster} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover/card:scale-[1.03]" />}
          {show.unseen > 0 && (
            <span className="bg-brand text-brand-foreground absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase">New</span>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-snug font-semibold">{show.name}</p>
      </Link>
      <div className="mt-1 flex items-center gap-2">
        <ServiceMark backend={show.backend} label className="text-muted-foreground text-xs" />
        {show.group && <Badge variant="secondary">{show.group}</Badge>}
        {menu.muted && <Badge variant="outline">Hidden</Badge>}
        <TileMenu channel={show} {...menu} className="ml-auto -mr-1.5 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" />
      </div>
    </article>
  );
}

function ChannelTile({ channel, ...menu }: TileProps & { channel: Channel }) {
  const { muted } = menu;
  const { byId } = useAccounts();
  const via = (channel.via ?? []).map(byId).filter((a): a is LinkedAccount => a !== undefined);
  return (
    <article className={cn("bg-card group relative flex min-w-0 flex-col items-center rounded-2xl border px-3 pt-5 pb-3 transition-colors hover:bg-muted/40", muted && "opacity-60")}>
      <TileMenu channel={channel} {...menu} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" />
      <Link to={paths.channel(channel)} className="flex w-full flex-col items-center text-center after:absolute after:inset-0">
        <ChannelAvatar name={channel.name} src={channel.avatar} ring={channel.unseen > 0} className="size-20" textClassName="text-2xl" />
        <h3 className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 font-semibold">{channel.name}</h3>
      </Link>
      <p className={cn("mt-1 text-xs", channel.unseen > 0 ? "text-brand-strong font-medium" : "text-muted-foreground")}>{channel.unseen > 0 ? `${channel.unseen} new in 48h` : "You're caught up"}</p>
      <div className="mt-3 flex min-h-6 w-full items-center gap-1.5"><ServiceMark backend={channel.backend} />{channel.group && <Badge variant="secondary" className="max-w-20 truncate">{channel.group}</Badge>}{muted && <Badge variant="outline">Hidden</Badge>}<span className="ml-auto flex -space-x-1.5" title={`Followed with ${via.map((a) => a.label).join(", ")}`}>{via.map((a) => <AccountAvatar key={a.id} account={a} className="ring-card size-5 ring-2" textClassName="text-[9px]" />)}</span></div>
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
