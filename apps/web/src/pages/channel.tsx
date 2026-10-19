import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { BellOff, Check, Rss, Search, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { SubscribeControl } from "@/components/accounts/subscribe-control";
import { ChannelAvatar } from "@/components/channel-avatar";
import { ChannelAbout } from "@/components/channel-about";
import { VideoCard } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChannelVideos } from "@/hooks/use-channel-videos";
import { RequestError } from "@/lib/api";
import { formatCount, hueFor } from "@/lib/format";
import { itemKey, paths } from "@/lib/paths";
import { ServiceMark } from "@/components/service-mark";
import { Thumbnail } from "@/components/video-card";
import { formatDuration } from "@/lib/format";
import type { ChannelPage as Page, Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";
import { actions, useStore } from "@/lib/store";
import { useTitle } from "@/hooks/use-title";
import { useArtworkGlow } from "@/lib/artwork-glow";

export function ChannelPage() {
  const { backend = "youtube", id = "" } = useParams();
  const ref = { backend, id };
  const [section, setSection] = useState<string | undefined>();
  const [tab, setTab] = useState("videos");
  const [sort, setSort] = useState<"new" | "popular">("new");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const { identity, state, loadMore, loadingMore, moreError, reload } = useChannelVideos(ref, section, query, query ? "new" : sort);
  const expired = moreError instanceof RequestError && moreError.code === "cursor_expired";
  const muted = useStore((s) => s.muted.includes(itemKey(ref)));
  const videos = state.data?.videos ?? [];

  // Preserve the header and focused search field while a new server-side view loads.
  const last = useRef<{ identity: string; page: Page } | null>(null);
  if (state.data) last.current = { identity, page: state.data };
  const page = state.data ?? (last.current?.identity === identity ? last.current.page : undefined);
  useTitle(page?.channel.name ?? (state.status === "loading" ? null : "Not found"));
  useArtworkGlow(page?.channel, state.status === "loading");

  if (page?.channel.kind === "series")
    return <ShowPage page={page} muted={muted} loading={state.status === "loading"} error={state.error} onRetry={reload} onSection={setSection} />;

  if (state.status === "loading" && !page)
    return (
      <div className="page">
        <Skeleton className="h-48 w-full rounded-3xl" />
        <div className="mt-6 flex items-center gap-4">
          <Skeleton className="size-24 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>
    );
  if (!page)
    return (
      <Empty className="mt-24">
        <EmptyHeader>
          <EmptyTitle>{state.error?.message ?? "Not found"}</EmptyTitle>
        </EmptyHeader>
        <Button variant="outline" onClick={reload}>Try again</Button>
        <Button asChild variant="outline">
          <Link to="/">Back to your feed</Link>
        </Button>
      </Empty>
    );

  const { channel } = page;
  const hue = hueFor(channel.name);

  return (
    <div className="page">
      <div
        className="relative h-36 overflow-hidden rounded-3xl sm:h-52"
        style={{
          background: `radial-gradient(120% 140% at 0% 0%, oklch(0.62 0.12 ${hue}), transparent 60%), radial-gradient(120% 140% at 100% 100%, oklch(0.5 0.12 ${(hue + 60) % 360}), transparent 60%), oklch(0.3 0.05 ${hue})`,
        }}
      >
        {channel.banner ? (
          <img src={channel.banner} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_22px,rgb(255_255_255/0.04)_22px_23px)]" />
        )}
      </div>

      <header className="-mt-10 flex flex-wrap items-end gap-5 pl-2 sm:-mt-12 sm:pl-6">
        <ChannelAvatar name={channel.name} src={channel.avatar} className="ring-background size-24 ring-4 sm:size-32" textClassName="text-3xl" />
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="font-display flex items-center gap-2 text-3xl font-semibold">
            {channel.name}
            {channel.verified && <Check className="bg-muted-foreground text-background size-5 rounded-full p-0.5" />}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {[
              channel.handle,
              channel.subscribers ? `${formatCount(channel.subscribers)} subscribers` : null,
              channel.videoCount ? `${formatCount(channel.videoCount)} videos` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pb-1">
          <SubscribeControl channel={channel} />
          <Button variant={muted ? "default" : "outline"} className="rounded-full px-4" onClick={() => actions.toggleMute(itemKey(ref))}>
            {muted ? <VolumeX /> : <BellOff />}
            {muted ? "Hidden from feed" : "Hide from feed"}
          </Button>
          {channel.feedUrl && (
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              aria-label="Copy RSS feed"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(channel.feedUrl!);
                  toast.success("RSS feed link copied", { description: "Follow this channel in any feed reader, no account needed." });
                } catch {
                  toast.error("Couldn't copy the feed link", { description: "Open About to access the feed." });
                }
              }}
            >
              <Rss />
            </Button>
          )}
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <div className="flex flex-wrap items-center gap-3 border-b">
          <TabsList variant="line" className="h-11">
            <TabsTrigger value="videos">Videos</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
          {tab === "videos" && <div className="ml-auto flex max-w-full flex-wrap items-center gap-2 pb-2">
            <form className="relative" role="search" aria-label="Search this channel" onSubmit={(event) => {
              event.preventDefault();
              const next = filter.trim();
              if (next === query) reload();
              else setQuery(next);
            }}>
              <button type="submit" aria-label="Search channel" className="text-muted-foreground absolute inset-y-0 left-0 grid w-8 place-items-center">
                <Search className="size-4" />
              </button>
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} maxLength={200} placeholder="Search channel" aria-label="Search channel videos" className="h-8 w-48 rounded-full pl-8" />
            </form>
            <Tabs value={query ? "" : sort} onValueChange={(v) => { setSort(v as "new" | "popular"); setQuery(""); setFilter(""); }}>
              <TabsList>
                <TabsTrigger value="new">Latest</TabsTrigger>
                <TabsTrigger value="popular">Popular</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>}
        </div>
        <TabsContent value="videos" className="mt-6">
          {query && (
            <div className="text-muted-foreground mb-4 flex items-center gap-3 text-sm">
              <p>Results for "{query}" across this channel, ranked by YouTube.</p>
              <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setFilter(""); }}>Clear search</Button>
            </div>
          )}
          {state.status === "error" && (
            <div className="mb-4 flex items-center gap-3">
              <p role="alert" className="text-destructive text-sm">{state.error.message}</p>
              <Button variant="outline" onClick={reload}>Try again</Button>
            </div>
          )}
          <div aria-busy={state.status === "loading"} className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {state.status === "loading"
              ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-video rounded-xl" />)
              : videos.map((video) => <VideoCard key={itemKey(video)} video={video} showChannel={false} />)}
          </div>
          <div className="mt-8 flex flex-col items-center gap-3">
            {state.status === "ready" && (
              <p className="text-muted-foreground text-center text-xs" role="status">
                {`${videos.length} ${query ? "results" : "videos"} shown.${state.data.next ? "" : query ? " End of results." : " No more videos."}`}
              </p>
            )}
            {moreError && <p role="alert" className="text-destructive max-w-prose text-center text-sm">{moreError.message}</p>}
            {state.data?.next && (
              <Button variant="outline" className="rounded-full px-6" disabled={loadingMore} onClick={() => expired ? reload() : void loadMore()}>
                {loadingMore ? "Loading more…" : expired ? "Reload videos" : moreError ? "Try again" : "Load more videos"}
              </Button>
            )}
          </div>
        </TabsContent>
        <TabsContent value="about" className="mt-6">
          <ChannelAbout channel={channel} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * A show: its key art as a backdrop, the poster, what it's about, then a season picker and the
 * episodes of that season with how far each one was watched.
 */
function ShowPage({ page, muted, loading, error, onRetry, onSection }: { page: Page; muted: boolean; loading: boolean; error?: Error; onRetry: () => void; onSection: (id: string) => void }) {
  const { channel, videos, sections = [], section } = page;
  const progress = useStore((s) => s.progress);
  const watched = (v: Video) => progress[itemKey(v)] ?? v.progress ?? 0;
  // Resume the first episode started but not finished; else the first one never played.
  const next = videos.find((v) => watched(v) > 0) ?? videos[0];
  const ref = { backend: channel.backend, id: channel.id };
  return (
    <div className="pb-16">
      <div className="relative isolate">
        {/* Key art as a backdrop that fades out on every side, so it has no hard edges against the bar and rail. */}
        {channel.banner && (
          <div
            aria-hidden
            className="absolute inset-0 -z-10 overflow-hidden"
            style={{
              maskImage: "linear-gradient(to bottom, transparent, black 30%, black 55%, transparent), linear-gradient(to right, transparent, black 35%)",
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            }}
          >
            <img src={channel.banner} alt="" className="size-full scale-105 object-cover opacity-45 blur-sm dark:opacity-35" />
          </div>
        )}
        <div aria-hidden className="from-background absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t to-transparent" />
        <div className="page flex flex-col gap-6 pb-10 sm:flex-row sm:items-end sm:gap-8">
          <div className="bg-muted aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-2xl shadow-2xl shadow-black/40 sm:w-52">
            {channel.poster && <img src={channel.poster} alt="" className="size-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <ServiceMark backend={channel.backend} label className="text-muted-foreground text-xs font-medium" />
            <h1 className="font-display mt-1 text-3xl font-semibold text-balance sm:text-5xl">{channel.name}</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {[sections.length > 1 ? `${sections.length} seasons` : null, channel.videoCount ? `${channel.videoCount} episodes` : null].filter(Boolean).join(" · ")}
            </p>
            {channel.description && <p className="mt-4 line-clamp-4 max-w-2xl text-sm leading-relaxed text-pretty">{channel.description}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {next && (
                <Button asChild size="lg" className="rounded-full px-5">
                  <Link to={paths.watch(next)}>
                    <Play className="fill-current" />
                    {watched(next) > 0 ? "Continue" : "Play"}{" "}
                    {/* The season's own name: services' season numbers don't always match it. */}
                    {[
                      sections.length > 1 ? sections.find((x) => x.id === section && x.label.length <= 12)?.label : null,
                      next.episode?.number ? `E${next.episode.number}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Link>
                </Button>
              )}
              <SubscribeControl channel={channel} />
              <Button variant={muted ? "default" : "outline"} className="rounded-full px-4" onClick={() => actions.toggleMute(itemKey(ref))}>
                {muted ? <VolumeX /> : <BellOff />}
                {muted ? "Hidden from feed" : "Hide from feed"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="page pt-0">
        {error && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p role="alert" className="text-destructive text-sm">{error.message} Showing the previously loaded season.</p>
            <Button variant="outline" onClick={onRetry}>Try again</Button>
          </div>
        )}
        {sections.length > 1 && (
          <div className="no-scrollbar -mx-2 -my-1.5 flex gap-2 overflow-x-auto px-2 py-1.5" role="tablist" aria-label="Seasons">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === section}
                onClick={() => onSection(s.id)}
                className={cn(
                  "bg-secondary text-secondary-foreground hover:bg-accent flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors",
                  s.id === section && "bg-foreground text-background hover:bg-foreground",
                )}
              >
                {s.label}
                {s.count ? <span className={cn("text-[11px] tabular-nums", s.id === section ? "text-background/70" : "text-muted-foreground")}>{s.count}</span> : null}
              </button>
            ))}
          </div>
        )}
        <ol className={cn("mt-4 grid gap-x-6 gap-y-5 lg:grid-cols-2", loading && "opacity-60 transition-opacity")}>
          {videos.map((video) => (
            <li key={video.id}>
              <Link to={paths.watch(video)} className="group/card hover:bg-muted/60 -m-2 flex gap-4 rounded-2xl p-2">
                <Thumbnail video={video} size="sm" className="w-44 shrink-0 sm:w-56" />
                <div className="min-w-0 py-0.5">
                  <p className="text-muted-foreground text-xs font-medium">
                    {[video.episode?.number ? `Episode ${video.episode.number}` : null, video.duration ? formatDuration(video.duration) : null].filter(Boolean).join(" · ")}
                  </p>
                  <h3 className="mt-0.5 line-clamp-2 leading-snug font-semibold">{video.title}</h3>
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{video.description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
        {!loading && !videos.length && <p className="text-muted-foreground mt-6 text-sm">No episodes in this season yet.</p>}
      </div>
    </div>
  );
}
