import { Clock3, History, ListVideo, Lock, Trash2 } from "lucide-react";
import { VideoCard, VideoRow } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useData } from "@/hooks/use-data";
import { formatAgo } from "@/lib/format";
import { useSource } from "@/lib/source";
import { useAccounts } from "@/lib/session";
import { actions, useSettings, useStore } from "@/lib/store";
import type { Video } from "@/lib/types";

/** Resolve stored video ids through the current backend; returns a lookup. */
function useVideoLookup(ids: string[]) {
  const source = useSource();
  const state = useData(() => source.videos(ids), [source.key, ids.join(",")]);
  const map = new Map((state.data ?? []).map((v) => [v.id, v]));
  return { loading: state.status === "loading", get: (id: string): Video | undefined => map.get(id) };
}

export function LibraryPage() {
  return (
    <div className="relative">
      <div className="page relative">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">Library</h1>
        <p className="text-muted-foreground mt-2 flex items-center gap-1.5">
          <Lock className="size-3.5" /> History and Watch later are saved to your Fanoos account and shared across your devices. Google never sees them.
        </p>
        <Tabs defaultValue="later" className="mt-8">
          <TabsList variant="line" className="h-11 border-b">
            <TabsTrigger value="later">
              <Clock3 /> Watch later
            </TabsTrigger>
            <TabsTrigger value="history">
              <History /> History
            </TabsTrigger>
            <TabsTrigger value="playlists">
              <ListVideo /> Playlists
            </TabsTrigger>
          </TabsList>
          <TabsContent value="later" className="mt-6">
            <WatchLater />
          </TabsContent>
          <TabsContent value="history" className="mt-6">
            <HistoryList />
          </TabsContent>
          <TabsContent value="playlists" className="mt-6">
            <Playlists />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function WatchLater() {
  const ids = useStore((s) => s.watchLater);
  const lookup = useVideoLookup(ids);
  const list = ids.map(lookup.get).filter((v) => v !== undefined);
  if (ids.length && lookup.loading) return <GridSkeleton />;
  if (!list.length)
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Clock3 />
          </EmptyMedia>
          <EmptyTitle>Nothing saved yet</EmptyTitle>
          <EmptyDescription>Hover a thumbnail and press the clock to save it for later.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {list.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}

function HistoryList() {
  const history = useStore((s) => s.history);
  const lookup = useVideoLookup(history.map((h) => h.id));
  const { keepHistory } = useSettings();
  return (
    <div className="max-w-4xl">
      <div className="bg-card mb-6 flex flex-wrap items-center gap-4 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <Switch id="keep-history" checked={keepHistory} onCheckedChange={(on) => actions.setting("keepHistory", on)} />
          <Label htmlFor="keep-history">Keep watch history</Label>
        </div>
        <Button variant="destructive" size="sm" className="ml-auto" disabled={!history.length} onClick={actions.clearHistory}>
          <Trash2 /> Clear history
        </Button>
      </div>
      {!history.length ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History />
            </EmptyMedia>
            <EmptyTitle>{keepHistory ? "No history yet" : "History is paused"}</EmptyTitle>
            <EmptyDescription>
              {keepHistory ? "Videos you play will show up here. They're saved to your Fanoos account, never sent to Google." : "Nothing you watch is being recorded."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {history.map(({ id, at }) => {
            const video = lookup.get(id);
            if (!video) return null;
            return (
              <div key={id}>
                <p className="text-muted-foreground mb-2 text-xs">Watched {formatAgo(at)}</p>
                <VideoRow video={video} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Playlists() {
  const source = useSource();
  const { byId } = useAccounts();
  const state = useData(() => source.playlists(), [source.key]);
  if (state.status !== "ready") return <GridSkeleton />;
  if (!state.data.length)
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListVideo />
          </EmptyMedia>
          <EmptyTitle>No playlists</EmptyTitle>
          <EmptyDescription>Playlists from all your accounts show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {state.data.map((playlist) => (
        <article key={`${playlist.accountId}:${playlist.id}`}>
          <div className="relative">
            <div className="bg-muted absolute inset-x-4 -top-2 h-4 rounded-t-xl opacity-60" />
            <div className="bg-muted absolute inset-x-2 -top-1 h-4 rounded-t-xl" />
            <div className="bg-muted relative aspect-video overflow-hidden rounded-xl">
              {playlist.thumbnail && <img src={playlist.thumbnail} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />}
              <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                <ListVideo className="size-3" /> {playlist.count} videos
              </span>
            </div>
          </div>
          <p className="mt-3 font-semibold">{playlist.title}</p>
          <p className="text-muted-foreground text-xs">
            {byId(playlist.accountId)?.label} · {playlist.private ? "Private" : "Public"}
          </p>
        </article>
      ))}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="aspect-video rounded-xl" />
      ))}
    </div>
  );
}
