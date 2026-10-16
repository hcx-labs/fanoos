import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { LayoutGrid, Link2, List, Settings2, Sparkles, X } from "lucide-react";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { ChannelAvatar } from "@/components/channel-avatar";
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
  if (age < 2 * DAY) return "Yesterday";
  if (age < 7 * DAY) return "This week";
  return "Earlier";
}

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
  const source = useSource();
  const subs = useData(() => source.following(), [source.key]);
  const feed = useData(
    () =>
      source.feed({
        group: group === "all" ? undefined : group,
        accountId: accountId === "all" ? undefined : accountId,
        backend: service === "all" ? undefined : service,
      }),
    [source.key, group, accountId, service],
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
    return [...local, ...fromServices].filter((v) => service === "all" || v.backend === service);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume.data, remote.data, progress, service]);
  // Episodes ("up next" from followed shows) get their own row; uploads fill the day sections.
  const episodes = useMemo(() => videos.filter((v) => v.episode), [videos]);
  const uploads = useMemo(() => videos.filter((v) => !v.episode), [videos]);
  const onlyShows = uploads.length === 0 && episodes.length > 0;
  // The hero spotlights the newest item from up to five channels or shows; the grid shows the rest.
  const heroVideos = useMemo(() => pickHeroVideos(onlyShows ? episodes : [...uploads.slice(0, 40), ...episodes.filter(isRecent)].sort(byNewest)), [uploads, episodes, onlyShows]);
  const rest = useMemo(() => (onlyShows ? episodes : uploads).filter((v) => !heroVideos.includes(v)), [uploads, episodes, onlyShows, heroVideos]);
  const showRow = !onlyShows ? episodes.filter((v) => !heroVideos.includes(v)) : [];
  const featured = heroVideos[0];
  const sections = useMemo(() => {
    const map = new Map<string, Video[]>();
    for (const video of rest) map.set(bucket(video.published), [...(map.get(bucket(video.published)) ?? []), video]);
    return [...map];
  }, [rest]);

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
                  onClick={() => setAccountId(a.id)}
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
          {categoryCounts.length > 1 ? (
            <div
              className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] pr-10"
              role="group"
              aria-label="Filter by category"
            >
            {[["all", feed.data?.length ?? 0] as [string, number], ...categoryCounts].map(([name, count]) => {
              const selected = category === name;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCategory(selected && name !== "all" ? "all" : name)}
                  className={cn(
                    "bg-secondary text-secondary-foreground hover:bg-accent flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                    selected && "bg-foreground text-background hover:bg-foreground",
                  )}
                >
                  {name === "all" ? "All videos" : name}
                  <span className={cn("text-[11px] tabular-nums", selected ? "text-background/70" : "text-muted-foreground")}>{count}</span>
                </button>
              );
            })}
            </div>
          ) : (
            <div className="flex-1" />
          )}
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

            {sections.map(([label, items]) => (
              <section key={label} className="mt-12" aria-labelledby={`s-${label}`}>
                <div className="mb-4 flex items-baseline gap-3">
                  <h2 id={`s-${label}`} className="font-display text-xl font-semibold">
                    {label}
                  </h2>
                  <span className="text-muted-foreground text-sm">
                    {items.length} {onlyShows ? (items.length === 1 ? "episode" : "episodes") : items.length === 1 ? "video" : "videos"}
                  </span>
                </div>
                {settings.feedLayout === "grid" ? (
                  <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {items.map((video) => (
                      <VideoCard key={itemKey(video)} video={video} />
                    ))}
                  </div>
                ) : (
                  <div className="flex max-w-5xl flex-col gap-6">
                    {items.map((video) => (
                      <VideoRow key={itemKey(video)} video={video} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </>
        )}
          </>
        )}
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
