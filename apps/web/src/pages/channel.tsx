import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { BellOff, Check, Rss, Search, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { SubscribeControl } from "@/components/accounts/subscribe-control";
import { ChannelAvatar } from "@/components/channel-avatar";
import { VideoCard } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useData } from "@/hooks/use-data";
import { formatCount, hueFor } from "@/lib/format";
import { useSource } from "@/lib/source";
import { actions, useStore } from "@/lib/store";

export function ChannelPage() {
  const { id = "" } = useParams();
  const source = useSource();
  const state = useData(() => source.channel(id), [source.key, id]);
  const muted = useStore((s) => s.muted.includes(id));
  const [sort, setSort] = useState<"new" | "popular">("new");
  const [filter, setFilter] = useState("");

  const videos = useMemo(() => {
    if (state.status !== "ready" || !state.data) return [];
    const list = state.data.videos.filter((v) => v.title.toLowerCase().includes(filter.toLowerCase()));
    return sort === "popular" ? [...list].sort((a, b) => b.views - a.views) : list;
  }, [state, sort, filter]);

  if (state.status === "loading")
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
  if (state.status === "error" || !state.data)
    return (
      <Empty className="mt-24">
        <EmptyHeader>
          <EmptyTitle>Channel not found</EmptyTitle>
        </EmptyHeader>
        <Button asChild variant="outline">
          <Link to="/">Back to your feed</Link>
        </Button>
      </Empty>
    );

  const { channel } = state.data;
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
          <Button variant={muted ? "default" : "outline"} className="rounded-full px-4" onClick={() => actions.toggleMute(channel.id)}>
            {muted ? <VolumeX /> : <BellOff />}
            {muted ? "Hidden from feed" : "Hide from feed"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label="Copy RSS feed"
            onClick={() => {
              void navigator.clipboard?.writeText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`);
              toast.success("RSS feed link copied", { description: "Follow this channel in any feed reader, no account needed." });
            }}
          >
            <Rss />
          </Button>
        </div>
      </header>

      <Tabs defaultValue="videos" className="mt-8">
        <div className="flex flex-wrap items-center gap-3 border-b">
          <TabsList variant="line" className="h-11">
            <TabsTrigger value="videos">Videos</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-2 pb-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search channel" className="h-8 w-48 rounded-full pl-8" />
            </div>
            <Tabs value={sort} onValueChange={(v) => setSort(v as "new" | "popular")}>
              <TabsList>
                <TabsTrigger value="new">Latest</TabsTrigger>
                <TabsTrigger value="popular">Popular</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <TabsContent value="videos" className="mt-6">
          <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} showChannel={false} />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="about" className="mt-6 max-w-2xl space-y-4 text-sm">
          <p className="text-base leading-relaxed whitespace-pre-line">{channel.description || "No description."}</p>
          <dl className="bg-card grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 rounded-2xl border p-5">
            {channel.subscribers ? (
              <>
                <dt className="text-muted-foreground">Subscribers</dt>
                <dd>{channel.subscribers.toLocaleString()}</dd>
              </>
            ) : null}
            {channel.videoCount ? (
              <>
                <dt className="text-muted-foreground">Videos</dt>
                <dd>{channel.videoCount.toLocaleString()}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">RSS feed</dt>
            <dd className="break-all">https://www.youtube.com/feeds/videos.xml?channel_id={channel.id}</dd>
          </dl>
        </TabsContent>
      </Tabs>
    </div>
  );
}
