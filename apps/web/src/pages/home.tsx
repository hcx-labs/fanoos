import { useMemo, useState } from "react";
import { Link } from "react-router";
import { LayoutGrid, Link2, List, Settings2, Sparkles } from "lucide-react";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Hero, pickHeroVideos } from "@/components/hero";
import { Thumbnail, VideoCard, VideoRow, useVideoTitle } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useData, type DataState } from "@/hooks/use-data";
import { formatDuration } from "@/lib/format";
import { paths } from "@/lib/paths";
import { useSource } from "@/lib/source";
import { useAccounts, useProfile } from "@/lib/session";
import { actions, useProgress, useSettings, useStore } from "@/lib/store";
import type { Channel, Video } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const [group, setGroup] = useState("all");
  const [focus, setFocus] = useState<string | null>(null);
  const settings = useSettings();
  const muted = useStore((s) => s.muted);
  const { accounts, inFeed } = useAccounts();
  const profile = useProfile();
  const [accountId, setAccountId] = useState("all");
  const source = useSource();
  const subs = useData(() => source.subscriptions(), [source.key]);
  const feed = useData(
    () => source.feed({ group: group === "all" ? undefined : group, accountId: accountId === "all" ? undefined : accountId }),
    [source.key, group, accountId],
  );
  // Groups come from the channels themselves, across every account.
  const groups = useMemo(() => [...new Set((subs.data ?? []).map((c) => c.group).filter((g): g is string => Boolean(g)))].sort(), [subs.data]);
  const watchedIds = useStore((s) => s.history);
  const progress = useStore((s) => s.progress);
  // Most recently saved positions first.
  const resumeIds = useMemo(() => Object.keys(progress).reverse().slice(0, 12), [progress]);
  const resume = useData(() => source.videos(resumeIds), [resumeIds.join(",")]);

  const videos = useMemo(() => {
    if (feed.status !== "ready") return [];
    return feed.data.filter(
      (v) =>
        !muted.includes(v.channelId) &&
        (!focus || v.channelId === focus) &&
        // "Watched" = played before and not left part-way.
        !(settings.hideWatched && watchedIds.some((h) => h.id === v.id) && !progress[v.id]),
    );
  }, [feed, muted, focus, settings.hideWatched, watchedIds, progress]);

  const inProgress = resume.data ?? [];
  // The hero spotlights the newest upload from up to five channels; the grid shows the rest.
  const heroVideos = useMemo(() => pickHeroVideos(videos), [videos]);
  const rest = useMemo(() => videos.filter((v) => !heroVideos.includes(v)), [videos, heroVideos]);
  const featured = heroVideos[0];
  const sections = useMemo(() => {
    const map = new Map<string, Video[]>();
    for (const video of rest) map.set(bucket(video.published), [...(map.get(bucket(video.published)) ?? []), video]);
    return [...map];
  }, [rest]);

  const unseen = subs.status === "ready" ? subs.data.reduce((total, c) => total + c.unseen, 0) : 0;
  const unseenChannels = subs.status === "ready" ? subs.data.filter((c) => c.unseen).length : 0;

  return (
    <div className="relative">
      <div className="page relative">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold sm:text-4xl">
              {greeting()}{profile ? `, ${profile.name.split(" ")[0]}` : ""}.
            </h1>
            <div className="text-muted-foreground mt-2 text-sm sm:text-base">
              {inFeed.length === 0 ? (
                "Nothing linked yet."
              ) : subs.status === "ready" ? (
                <>
                  <span className="text-foreground font-medium">{unseen} new videos</span> from {unseenChannels} channels across {inFeed.length} {inFeed.length === 1 ? "account" : "accounts"}.
                  Newest first — no recommendations, no algorithm.
                </>
              ) : (
                <Skeleton className="inline-block h-4 w-72 align-middle" />
              )}
            </div>
          </div>
        </header>

        {inFeed.length === 0 ? (
          <Empty className="bg-card/50 mt-10 rounded-3xl border py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2 />
              </EmptyMedia>
              <EmptyTitle>{accounts.length ? "No accounts in your feed" : "Link a YouTube account"}</EmptyTitle>
              <EmptyDescription>
                {accounts.length
                  ? "Every linked account is switched off for the feed. Turn one back on to see its subscriptions."
                  : "Your feed is built from the subscriptions of the accounts you link. Link as many as you like."}
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild className="rounded-full px-5">
              <Link to="/settings#accounts">{accounts.length ? "Manage linked accounts" : "Link an account"}</Link>
            </Button>
          </Empty>
        ) : (
          <>
        <ChannelRail state={subs} focus={focus} onFocus={setFocus} />

        {inFeed.length > 1 && (
          <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Show subscriptions from">
            {[{ id: "all", label: "Everything" }, ...inFeed].map((a) => {
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {groups.length > 0 && (
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
          )}
          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="hide-watched" checked={settings.hideWatched} onCheckedChange={(on) => actions.setting("hideWatched", on)} />
              <Label htmlFor="hide-watched" className="text-muted-foreground text-[13px]">
                Hide watched
              </Label>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={settings.feedLayout}
              onValueChange={(value) => value && actions.setting("feedLayout", value as "grid" | "list")}
              aria-label="Layout"
            >
              <ToggleGroupItem value="grid" aria-label="Grid">
                <LayoutGrid />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

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
              <section className="mt-12" aria-labelledby="continue">
                <h2 id="continue" className="font-display mb-4 text-xl font-semibold">
                  Continue watching
                </h2>
                <Carousel opts={{ align: "start", dragFree: true }} className="group/carousel">
                  <CarouselContent className="-ml-4">
                    {inProgress.map((video) => (
                      <CarouselItem key={video.id} className="basis-[78%] pl-4 sm:basis-1/2 lg:basis-1/3 xl:basis-1/4 2xl:basis-1/5">
                        <ContinueCard video={video} />
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className="left-2 hidden opacity-0 transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 sm:flex" />
                  <CarouselNext className="right-2 hidden opacity-0 transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 sm:flex" />
                </Carousel>
              </section>
            )}

            {sections.map(([label, items]) => (
              <section key={label} className="mt-12" aria-labelledby={`s-${label}`}>
                <div className="mb-4 flex items-baseline gap-3">
                  <h2 id={`s-${label}`} className="font-display text-xl font-semibold">
                    {label}
                  </h2>
                  <span className="text-muted-foreground text-sm">{items.length} videos</span>
                </div>
                {settings.feedLayout === "grid" ? (
                  <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {items.map((video) => (
                      <VideoCard key={video.id} video={video} />
                    ))}
                  </div>
                ) : (
                  <div className="flex max-w-5xl flex-col gap-6">
                    {items.map((video) => (
                      <VideoRow key={video.id} video={video} />
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
              const active = focus === channel.id;
              return (
                <button
                  key={channel.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFocus(active ? null : channel.id)}
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
        to="/subscriptions"
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
  const left = video.duration - (useProgress(video.id) ?? 0);
  return (
    <Link to={paths.watch(video)} className="group/card block">
      <Thumbnail video={video} size="sm" />
      <p className="mt-2 line-clamp-1 text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground text-xs">{formatDuration(left)} left</p>
    </Link>
  );
}

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
