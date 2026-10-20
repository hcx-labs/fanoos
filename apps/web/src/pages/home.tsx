import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router";
import { LayoutGrid, Link2, List, Settings2, Sparkles, X } from "lucide-react";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { ChannelAvatar } from "@/components/channel-avatar";
import { FeedFilterPills } from "@/components/feed-filter-pills";
import { Hero, pickHeroVideos } from "@/components/hero";
import { PageHeader, ServicePills } from "@/components/page-header";
import { Thumbnail, VideoCard, VideoRow, useVideoTitle } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { Shelf } from "@/components/shelf";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useData, type DataState } from "@/hooks/use-data";
import { formatDuration } from "@/lib/format";
import { channelRef, itemKey, parseKey, paths } from "@/lib/paths";
import { episodeLabel, ServiceMark } from "@/components/service-mark";
import { useSource } from "@/lib/source";
import { backendName, useAccounts, useProfile } from "@/lib/session";
import { actions, useProgress, useSettings, useStore } from "@/lib/store";
import type { Channel, Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/use-title";

const DAY = 864e5;

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function bucket(iso: string) {
  const age = Date.now() - new Date(iso).getTime();
  if (age < DAY) return "Today";
  // What the sticky bar calls the videos being scrolled past (Yesterday is only a quick filter).
  if (age < 7 * DAY) return "This week";
  if (age < 30 * DAY) return "This month";
  return "Earlier";
}

/** Quick filters next to the sticky day heading: how far back the feed goes (Yesterday alone is one day). */
const ranges = [
  { label: "Today", from: 0, to: DAY },
  { label: "Yesterday", from: DAY, to: 2 * DAY },
  { label: "This week", from: 0, to: 7 * DAY },
  { label: "This month", from: 0, to: 30 * DAY },
] as const;
type Range = (typeof ranges)[number]["label"];
const inRange = (iso: string, range: Range) => {
  const r = ranges.find((x) => x.label === range)!;
  const age = Date.now() - new Date(iso).getTime();
  return age >= r.from && age < r.to;
};

export function HomePage() {
  useTitle("Home");
  const [group, setGroup] = useState("all");
  const [focus, setFocus] = useState<string | null>(null);
  const settings = useSettings();
  const muted = useStore((s) => s.muted);
  const { accounts, inFeed, feedBackends, backendOf } = useAccounts();
  const profile = useProfile();
  const [accountId, setAccountId] = useState("all");
  // Which service the home page shows: "all", or one backend's slug.
  const [service, setService] = useState("all");
  const [library, setLibrary] = useState("all");
  const selectedBackend = feedBackends.find((backend) => backend.slug === service) ?? (feedBackends.length === 1 ? feedBackends[0] : undefined);
  const plexSelected = selectedBackend?.info?.kind === "plex";
  const activeLibrary = plexSelected && library !== "all" ? library : undefined;
  const source = useSource();
  const subs = useData(() => source.following(), [source.key]);
  const feed = useData(
    () =>
      source.feed({
        group: group === "all" ? undefined : group,
        accountId: accountId === "all" ? undefined : accountId,
        backend: service === "all" ? undefined : service,
        library: activeLibrary,
      }),
    [source.key, group, accountId, service, activeLibrary],
  );
  // Groups come from the channels themselves, across every account.
  const groups = useMemo(() => [...new Set((subs.data ?? []).map((c) => c.group).filter((g): g is string => Boolean(g)))].sort(), [subs.data]);
  const watchedIds = useStore((s) => s.history);
  const progress = useStore((s) => s.progress);
  // Most recently saved positions first (kept in the Fanoos account).
  const resumeKeys = useMemo(() => Object.keys(progress).reverse().slice(0, 12), [progress]);
  const resume = useData(() => source.videos(resumeKeys.map(parseKey)), [resumeKeys.join(",")]);
  // Positions services keep themselves (Crunchyroll's history).
  const remote = useData(() => source.continueWatching(), [source.key]);
  const feedAccounts = service === "all" ? inFeed : inFeed.filter((a) => backendOf(a)?.slug === service);
  // Account chips only help to pick between several accounts on the same service; with one
  // account per service, the service pills already say it all.
  const sameService = service !== "all" ? feedAccounts : feedBackends.length === 1 ? inFeed : [];
  const accountChoices = sameService.length > 1 ? sameService : [];

  const libraries = (subs.data ?? []).filter((channel) => channel.kind === "library" && channel.backend === selectedBackend?.slug && (accountId === "all" || channel.via?.includes(accountId)));

  // Categories present in the feed, most common first (YouTube's own video categories).
  const [category, setCategory] = useState("all");
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of feed.data ?? []) if (v.category && !v.episode) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [feed.data]);

  const videos = useMemo(() => {
    if (feed.status !== "ready") return [];
    return feed.data.filter(
      (v) =>
        !muted.includes(itemKey(channelRef(v))) &&
        (!focus || `${v.backend}:${v.channelId}` === focus) &&
        // "Watched" = played before and not left part-way.
        !(settings.hideWatched && watchedIds.some((h) => h.id === itemKey(v)) && !progress[itemKey(v)]) &&
        (category === "all" || v.category === category || (v.episode && category === "all")),
    );
  }, [feed, muted, focus, settings.hideWatched, watchedIds, progress, category]);

  // Keep the last loaded list while a refetch runs, filtered to what's still in progress,
  // so removing an item updates instantly instead of the row flickering away.
  const lastResume = useRef<Video[]>([]);
  if (resume.data) lastResume.current = resume.data;
  const inProgress = useMemo(() => {
    const local = lastResume.current.filter((v) => progress[itemKey(v)]);
    const seen = new Set(local.map(itemKey));
    const fromServices = (remote.data ?? []).filter((v) => !seen.has(itemKey(v)));
    return [...local, ...fromServices].filter((v) => (service === "all" || v.backend === service) && (!activeLibrary || v.libraryId === activeLibrary));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume.data, remote.data, progress, service, activeLibrary]);
  // Episodes ("up next" from followed shows) also get their own row; the feed mixes them with uploads.
  const episodes = useMemo(() => videos.filter((v) => v.episode), [videos]);
  const uploads = useMemo(() => videos.filter((v) => !v.episode), [videos]);
  const onlyShows = uploads.length === 0 && episodes.length > 0;
  // The hero spotlights the newest item from up to five channels or shows; the grid shows the rest.
  const heroVideos = useMemo(() => pickHeroVideos(onlyShows ? episodes : [...uploads.slice(0, 40), ...episodes.filter(isRecent)].sort(byNewest)), [uploads, episodes, onlyShows]);
  const rest = useMemo(() => [...uploads, ...episodes].filter((v) => !heroVideos.includes(v)).sort(byNewest), [uploads, episodes, heroVideos]);
  const showRow = !onlyShows ? episodes.filter((v) => !heroVideos.includes(v)) : [];
  const featured = heroVideos[0];
  // The quick filter picked; until one is, the first range with videos (Today, then Yesterday,
  // This week, This month; everything if all are empty).
  const [picked, setRange] = useState<Range | null | undefined>(undefined);
  const feedTop = useRef<HTMLDivElement>(null);
  // One continuous feed; the quick filters narrow it.
  // Only offer ranges that have something in them.
  const rangeCounts = useMemo(() => ranges.map((r) => [r.label, rest.filter((v) => inRange(v.published, r.label)).length] as const), [rest]);
  const range = picked === undefined ? (rangeCounts.find(([, count]) => count > 0)?.[0] ?? null) : picked;
  const shown = useMemo(() => (range ? rest.filter((v) => inRange(v.published, range)) : rest), [rest, range]);
  // Where each group starts in the feed (the cards FeedBar watches).
  const startOf = useMemo(() => {
    const starts = new Map<string, string>();
    let previous = "";
    for (const v of shown) {
      const b = bucket(v.published);
      if (b !== previous) starts.set(itemKey(v), b);
      previous = b;
    }
    return starts;
  }, [shown]);
  const rangePicked = useRef(false);
  const pickRange = (next: Range) => {
    rangePicked.current = true;
    setRange(range === next ? null : next);
  };
  // Once the filtered feed is drawn, put its first heading right under the top bar (if the
  // page was scrolled past it), so the chips stay where they were clicked.
  useLayoutEffect(() => {
    if (!rangePicked.current) return;
    rangePicked.current = false;
    const bar = feedTop.current;
    const first = document.querySelector<HTMLElement>("[data-feed]");
    if (!bar || !first) return;
    // The feed's first row just under the stuck bar (top bar 64px, then the bar, then mt-4).
    const top = window.scrollY + first.getBoundingClientRect().top - 64 - bar.offsetHeight - 16;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "instant" });
  }, [range]);

  const followed = (subs.data ?? []).filter((c) => service === "all" || c.backend === service);
  const unseen = followed.filter((c) => c.kind !== "series").reduce((total, c) => total + c.unseen, 0);
  const unseenChannels = followed.filter((c) => c.kind !== "series" && c.unseen).length;
  const newShows = followed.filter((c) => c.kind === "series" && c.unseen).length;

  return (
    <div className="relative">
      <div className="page relative">
        <PageHeader
          title={`${greeting()}${profile ? `, ${profile.name.split(" ")[0]}` : ""}.`}
          description={
            <>
              {inFeed.length === 0 ? (
                "Nothing linked yet."
              ) : plexSelected && feed.status === "ready" ? (
                <>{feed.data.length} recent {feed.data.length === 1 ? "addition" : "additions"} from {activeLibrary ? libraries.find((c) => c.id === activeLibrary)?.name ?? "this library" : `${libraries.length} libraries`}.</>
              ) : subs.status === "ready" ? (
                <>
                  {unseenChannels > 0 || !newShows ? (
                    <>
                      <span className="text-foreground font-medium">{unseen} new videos</span> from {unseenChannels} channels
                    </>
                  ) : null}
                  {unseenChannels > 0 && newShows > 0 ? " and " : null}
                  {newShows > 0 && (
                    <>
                      <span className="text-foreground font-medium">
                        new episodes of {newShows} {newShows === 1 ? "show" : "shows"}
                      </span>
                    </>
                  )}{" "}
                  across {feedAccounts.length} {feedAccounts.length === 1 ? "account" : "accounts"}.
                </>
              ) : (
                <Skeleton className="inline-block h-4 w-72 align-middle" />
              )}
            </>
          }
        />

        {inFeed.length === 0 ? (
          <Empty className="bg-card/50 mt-10 rounded-3xl border py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2 />
              </EmptyMedia>
              <EmptyTitle>{accounts.length ? "No accounts in your feed" : "Link an account"}</EmptyTitle>
              <EmptyDescription>
                {accounts.length
                  ? "Every linked account is switched off for the feed. Turn one back on to see what it follows."
                  : "Your feed is built from what your linked accounts follow: YouTube subscriptions, Crunchyroll watchlists. Link as many as you like."}
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild className="rounded-full px-5">
              <Link to="/settings#accounts">{accounts.length ? "Manage linked accounts" : "Link an account"}</Link>
            </Button>
          </Empty>
        ) : (
          <>
        <ChannelRail state={subs} focus={focus} onFocus={setFocus} />

        {(feedBackends.length > 1 || accountChoices.length > 1) && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {feedBackends.length > 1 && (
              <ServicePills
                label="Service"
                value={service}
                onChange={(slug) => {
                  setService(slug);
                  setAccountId("all");
                  setCategory("all");
                  setLibrary("all");
                  setFocus(null);
                }}
                options={[{ value: "all", label: "Everything" }, ...feedBackends.map((b) => ({ value: b.slug, label: backendName(b), color: b.info?.color }))]}
              />
            )}
            {accountChoices.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show what's followed by">
            {[{ id: "all", label: "All accounts" }, ...accountChoices].map((a) => {
              const selected = accountId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { setAccountId(a.id); setLibrary("all"); }}
                  className={cn(
                    "text-muted-foreground hover:text-foreground flex h-9 items-center gap-2 rounded-full border px-1.5 pr-3.5 text-[13px] font-medium transition-colors",
                    a.id === "all" && "pl-3.5",
                    selected && "border-foreground text-foreground bg-card",
                  )}
                >
                  {"backendId" in a && <AccountAvatar account={a} className="size-6" textClassName="text-[10px]" />}
                  {a.label}
                </button>
              );
            })}
          </div>
            )}
          </div>
        )}

        {/* One line: category chips scroll sideways; view controls stay pinned on the right. */}
        <div className="mt-6 flex items-center gap-4">
          {plexSelected && libraries.length > 0 ? (
            <FeedFilterPills label="Plex library" value={activeLibrary ?? "all"} onChange={(value) => { setLibrary(value); setFocus(null); setCategory("all"); setGroup("all"); setRange(undefined); }} options={[
              { value: "all", label: "All libraries" },
              ...libraries.map((channel) => ({ value: channel.id, label: libraries.some((other) => other.id !== channel.id && other.name === channel.name) && channel.handle ? `${channel.name} · ${channel.handle}` : channel.name })),
            ]} />
          ) : categoryCounts.length > 1 ? (
            <FeedFilterPills label="Filter by category" value={category} onChange={(value) => setCategory(category === value && value !== "all" ? "all" : value)} options={[
              { value: "all", label: "All videos", count: feed.data?.length ?? 0 },
              ...categoryCounts.map(([name, count]) => ({ value: name, label: name, count })),
            ]} />
          ) : <div className="flex-1" />}
          <div className="flex shrink-0 items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="hide-watched" checked={settings.hideWatched} onCheckedChange={(on) => actions.setting("hideWatched", on)} />
              <Label htmlFor="hide-watched" className="text-muted-foreground text-[13px]">
                <span className="sr-only sm:not-sr-only">Hide watched</span>
              </Label>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={settings.feedLayout}
              onValueChange={(value) => value && actions.setting("feedLayout", value as "grid" | "list")}
              aria-label="Layout"
              className="hidden sm:flex"
            >
              {(
                [
                  ["grid", "Grid view", LayoutGrid],
                  ["list", "List view: bigger thumbnails with descriptions", List],
                ] as const
              ).map(([value, label, Icon]) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem value={value} aria-label={label} className="data-[state=on]:bg-foreground data-[state=on]:text-background">
                      <Icon />
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {groups.length > 0 && (
          <div className="mt-3">
          <ToggleGroup
            type="single"
            value={group}
            onValueChange={(value) => value && setGroup(value)}
            spacing={1}
            className="no-scrollbar -mx-1 max-w-full overflow-x-auto px-1"
            aria-label="Channel group"
          >
            {["all", ...groups].map((g) => (
              <ToggleGroupItem
                key={g}
                value={g}
                className="data-[state=on]:bg-foreground data-[state=on]:text-background bg-secondary h-8 rounded-full px-4 text-[13px] font-medium"
              >
                {g === "all" ? "All channels" : g}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          </div>
        )}

        {feed.status === "loading" && <FeedSkeleton />}

        {feed.status === "ready" && videos.length === 0 && (
          <Empty className="mt-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sparkles />
              </EmptyMedia>
              <EmptyTitle>You're all caught up</EmptyTitle>
              <EmptyDescription>Nothing new matches these filters. Go outside, maybe?</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {feed.status === "ready" && featured && (
          <>
            <Hero videos={heroVideos} />

            {inProgress.length > 0 && !focus && (
              <Shelf
                id="continue"
                title="Continue watching"
                actions={
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => actions.forgetProgress()}>
                    Clear all
                  </Button>
                }
                items={inProgress}
                itemKey={itemKey}
                itemClassName="basis-[78%] sm:basis-1/2 lg:basis-1/3 xl:basis-1/4 2xl:basis-1/5"
                render={(video) => <ContinueCard video={video} />}
              />
            )}

            {showRow.length > 0 && !focus && (
              <Shelf
                id="shows"
                title="Up next from your shows"
                meta={<ServiceMark backend={showRow[0]!.backend} label className="text-muted-foreground text-xs" />}
                items={showRow}
                itemKey={itemKey}
                render={(video) => <EpisodeCard video={video} />}
              />
            )}

            {shown.length > 0 && <FeedBar ref={feedTop} shown={shown} range={range} rangeCounts={rangeCounts} onPick={pickRange} />}
            {shown.length > 0 && (
              <div data-feed className="mt-4">
                {settings.feedLayout === "grid" ? (
                  <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {shown.map((video) => (
                      <div key={itemKey(video)} data-bucket-start={startOf.get(itemKey(video))} className="min-w-0">
                        <VideoCard video={video} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex max-w-5xl flex-col gap-6">
                    {shown.map((video) => (
                      <div key={itemKey(video)} data-bucket-start={startOf.get(itemKey(video))}>
                        <VideoRow video={video} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One bar over the whole feed: it names what's being scrolled past (Today, This week…) and holds
 * the quick filters. Its own component, so the label changing while scrolling re-renders only
 * the bar, not the page (the channel rail and every card). No panel: solid pills float over
 * the cards, and clicks between them reach the cards.
 */
function FeedBar({
  ref,
  shown,
  range,
  rangeCounts,
  onPick,
}: {
  ref: RefObject<HTMLDivElement | null>;
  shown: Video[];
  range: Range | null;
  rangeCounts: (readonly [Range, number])[];
  onPick: (range: Range) => void;
}) {
  // The latest group whose first card has gone up under the bar. Watched with an observer on
  // those first cards only, so scrolling itself costs nothing.
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const bar = ref.current;
    const firsts = [...document.querySelectorAll<HTMLElement>("[data-bucket-start]")];
    if (!bar || !firsts.length) return;
    const line = 64 + bar.offsetHeight;
    const passed = new Map<Element, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) passed.set(e.target, e.boundingClientRect.top < line);
        setCurrent(firsts.filter((el) => passed.get(el)).at(-1)?.dataset.bucketStart ?? null);
      },
      // Fully inside the area below the bar, or not: fires as a card's top crosses the bar.
      { rootMargin: `-${line}px 0px 0px 0px`, threshold: 1 },
    );
    for (const el of firsts) observer.observe(el);
    return () => observer.disconnect();
  }, [shown, ref]);
  const label = range ?? current ?? (shown[0] ? bucket(shown[0].published) : "");
  const items = range ? shown : shown.filter((v) => bucket(v.published) === label);

  return (
    <div ref={ref} className="pointer-events-none sticky top-16 z-20 mt-12 flex flex-wrap items-center gap-x-3 gap-y-2 py-3 select-none">
      {/* Solid pills: readable over any thumbnail or text, light or dark. */}
      <div className="bg-background flex h-9 items-baseline gap-2 rounded-full border px-4 pt-1.5 shadow-lg shadow-black/15">
        <h2 className="font-display text-base font-semibold">{label}</h2>
        <span className="text-muted-foreground text-xs font-medium">{countLabel(items)}</span>
      </div>
      <div className="pointer-events-auto ml-auto flex flex-wrap gap-1.5" role="group" aria-label="Show videos from">
        {rangeCounts
          .filter(([, count]) => count > 0)
          .map(([r]) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => onPick(r)}
              className={cn(
                "text-muted-foreground hover:text-foreground bg-background flex h-9 items-center gap-1 rounded-full border px-3.5 text-xs font-medium shadow-lg shadow-black/15 transition-colors",
                range === r && "border-foreground text-foreground",
              )}
            >
              {r}
              {range === r && <X className="size-3" />}
            </button>
          ))}
      </div>
    </div>
  );
}

function ChannelRail({
  state,
  focus,
  onFocus,
}: {
  state: DataState<Channel[]>;
  focus: string | null;
  onFocus: (id: string | null) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 mt-8 flex gap-5 overflow-x-auto px-4 pt-1 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:hidden">
      {state.status !== "ready"
        ? Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex w-16 shrink-0 flex-col items-center gap-2">
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))
        : [...state.data]
            .sort((a, b) => b.unseen - a.unseen)
            .map((channel) => {
              const key = `${channel.backend}:${channel.id}`;
              const active = focus === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFocus(active ? null : key)}
                  className={cn(
                    "group flex w-16 shrink-0 flex-col items-center gap-2 transition-opacity",
                    focus && !active && "opacity-45 hover:opacity-80",
                  )}
                >
                  <span className="relative">
                    <ChannelAvatar
                      name={channel.name}
                      src={channel.avatar}
                      ring={channel.unseen > 0}
                      className={cn("size-14 transition-transform group-hover:scale-105", active && "ring-foreground ring-2 ring-offset-2 ring-offset-background")}
                      textClassName="text-base"
                    />
                    {channel.unseen > 0 && (
                      <span className="bg-brand text-brand-foreground ring-background absolute -right-1 -bottom-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold ring-2">
                        {channel.unseen}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground group-hover:text-foreground line-clamp-1 w-full text-center text-[11px] font-medium">
                    {channel.name}
                  </span>
                </button>
              );
            })}
      <Link
        to="/following"
        className="text-muted-foreground hover:text-foreground flex w-16 shrink-0 flex-col items-center gap-2"
      >
        <span className="grid size-14 place-items-center rounded-full border border-dashed">
          <Settings2 className="size-5" />
        </span>
        <span className="text-[11px] font-medium">Manage</span>
      </Link>
    </div>
  );
}

function ContinueCard({ video }: { video: Video }) {
  const title = useVideoTitle(video);
  const saved = useProgress(itemKey(video));
  const left = video.duration - (saved ?? video.progress ?? 0);
  return (
    <div className="group/card relative">
      <Link to={paths.watch(video)} className="block">
        <Thumbnail video={video} size="sm" />
        <p className="mt-2 line-clamp-1 text-sm font-semibold">{video.episode ? video.episode.seriesTitle : title}</p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <ServiceMark backend={video.backend} />
          {[video.episode ? episodeLabel(video.episode) : null, `${formatDuration(left)} left`].filter(Boolean).join(" · ")}
        </p>
      </Link>
      {/* Only positions kept in the Fanoos account can be dropped here; services keep their own. */}
      {saved !== undefined && (
      <button
        type="button"
        aria-label={`Remove “${title}” from Continue watching`}
        title="Remove from Continue watching"
        onClick={() => actions.forgetProgress(itemKey(video))}
        className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-black/70 text-white opacity-0 backdrop-blur transition-opacity group-hover/card:opacity-100 hover:bg-black/90 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X className="size-4" />
      </button>
      )}
    </div>
  );
}

/** An episode up next from a followed show: wide thumbnail, show name first. */
function EpisodeCard({ video }: { video: Video }) {
  return (
    <Link to={paths.watch(video)} className="group/card block">
      <Thumbnail video={video} />
      <p className="text-muted-foreground mt-2 truncate text-xs font-medium">
        {[video.episode?.seriesTitle, episodeLabel(video.episode)].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-0.5 line-clamp-2 text-sm leading-snug font-semibold">{video.title}</p>
    </Link>
  );
}

const byNewest = (a: Video, b: Video) => b.published.localeCompare(a.published);

/** "12 videos", "3 episodes", or "12 videos · 3 episodes". */
function countLabel(items: Video[]) {
  const episodes = items.filter((v) => v.episode).length;
  const videos = items.length - episodes;
  return [videos && `${videos} ${videos === 1 ? "video" : "videos"}`, episodes && `${episodes} ${episodes === 1 ? "episode" : "episodes"}`].filter(Boolean).join(" · ");
}
const isRecent = (v: Video) => Date.now() - new Date(v.published).getTime() < 7 * DAY;

function FeedSkeleton() {
  return (
    <>
      <Skeleton className="mt-8 aspect-[21/8] w-full rounded-3xl" />
      <div className="mt-12 grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <Skeleton className="aspect-video rounded-xl" />
            <div className="mt-3 flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
