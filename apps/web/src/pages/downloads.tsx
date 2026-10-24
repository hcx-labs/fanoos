import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertTriangle, ArrowLeft, Clock3, Download, HardDrive, Pause, Play, RotateCcw, Trash2, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { ChannelAvatar } from "@/components/channel-avatar";
import { RemoveDownloadDialog } from "@/components/download-button";
import { episodeLabel } from "@/components/service-mark";
import { Thumbnail } from "@/components/video-card";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { useTitle } from "@/hooks/use-title";
import { downloadBridge, downloadGroups, downloadPath, fileSize, isPending, timeLeft, transferRate, useDownloads } from "@/lib/downloads";
import type { DownloadLibrary, OfflineDownload } from "@/lib/types";

const offline = () => Boolean(window.fanoosDesktop?.offline);

/** Runs a bridge action, reporting failures; the library refreshes itself on change. */
function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await refresh(); }
    catch (e) { toast.error("Download action failed", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return [busy, (work: () => Promise<unknown>) => void run(work)] as const;
}

/** A clock for countdowns, ticking only while something is counting down. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function statusLine(item: OfflineDownload, now: number) {
  const progress = item.total ? Math.min(100, Math.round(item.received / item.total * 100)) : 0;
  if (item.status === "downloading") return [`${progress}%`, `${fileSize(item.received)} of ${fileSize(item.total)}`, item.speed ? transferRate(item.speed) : "", timeLeft(item)].filter(Boolean).join(" · ");
  if (item.status === "queued" && item.retryAt) return `Connection interrupted. Retrying in ${Math.max(1, Math.ceil((item.retryAt - now) / 1000))}s`;
  if (item.status === "queued") return `Waiting · ${fileSize(item.total)}`;
  if (item.status === "paused" && item.resumeOnConnect) return offline() ? `${progress}% · Continues when you reconnect` : `${progress}% · Continuing shortly`;
  if (item.status === "paused") return `Paused · ${progress}% of ${fileSize(item.total)}`;
  return "Download failed";
}

/** A row in the queue: what's transferring, waiting, paused or needs a retry. */
function QueueRow({ item, refresh, now }: { item: OfflineDownload; refresh: () => Promise<void>; now: number }) {
  const [busy, run] = useAction(refresh);
  const bridge = downloadBridge()!;
  const progress = item.total ? Math.min(100, item.received / item.total * 100) : 0;
  const stopped = item.status === "paused" || item.status === "failed";
  return <li className="flex items-center gap-4 py-3">
    <div className="bg-muted relative hidden aspect-video w-36 shrink-0 overflow-hidden rounded-lg sm:block">
      {item.video.thumbnail && !offline() ? <img src={item.video.thumbnail} alt="" referrerPolicy="no-referrer" className="size-full object-cover" /> : <div className="text-muted-foreground grid size-full place-items-center"><Download className="size-5" /></div>}
    </div>
    <div className="min-w-0 flex-1">
      <h3 className="truncate text-sm font-semibold">{item.video.title}</h3>
      <p className="text-muted-foreground truncate text-xs">{[item.video.episode?.seriesTitle ?? item.video.channelName, episodeLabel(item.video.episode), item.quality].filter(Boolean).join(" · ")}</p>
      <Progress aria-label={`${item.video.title} download progress`} value={progress} className={cn("mt-2 h-1.5", stopped && "[&>[data-slot=progress-indicator]]:bg-muted-foreground/60")} />
      <p role="status" className={cn("mt-1.5 flex items-center gap-1.5 text-xs", item.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
        {item.status === "downloading" && <Spinner className="size-3" />}
        {item.status === "failed" && <AlertTriangle className="size-3.5 shrink-0" />}
        {item.status === "queued" && item.retryAt && <Clock3 className="size-3.5 shrink-0" />}
        <span className="truncate tabular-nums">{statusLine(item, now)}</span>
      </p>
      {item.error && <p className="text-destructive mt-1 line-clamp-2 text-xs">{item.error}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {isPending(item)
        ? <Button variant="ghost" size="icon" aria-label={`Pause ${item.video.title}`} title="Pause" disabled={busy} onClick={() => run(() => bridge.pause(item.id))}><Pause className="size-4" /></Button>
        : <Button variant="secondary" size="sm" disabled={busy || offline()} title={offline() ? "Reconnect to your server to continue" : undefined} onClick={() => run(() => bridge.resume(item.id))}><RotateCcw className="size-4" />{item.status === "failed" ? "Retry" : "Resume"}</Button>}
      <Button variant="ghost" size="icon" aria-label={`Cancel ${item.video.title}`} title="Cancel and delete" disabled={busy} onClick={() => run(() => bridge.remove(item.id))}><X className="size-4" /></Button>
    </div>
  </li>;
}

function Queue({ items, refresh }: { items: OfflineDownload[]; refresh: () => Promise<void> }) {
  const [busy, run] = useAction(refresh);
  const bridge = downloadBridge()!;
  const now = useNow(items.some((i) => i.retryAt));
  const running = items.some(isPending);
  const resumable = items.some((i) => !isPending(i) || i.retryAt);
  return <section aria-labelledby="queue-heading" className="mb-10">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <h2 id="queue-heading" className="font-display text-xl font-semibold">Downloading <span className="text-muted-foreground ml-1 font-sans text-xs font-normal">{items.length}</span></h2>
      <div className="flex gap-2">
        {bridge.pauseAll && running && <Button variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => run(() => bridge.pauseAll!())}><Pause className="size-4" />Pause all</Button>}
        {bridge.resumeAll && resumable && !offline() && <Button variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => run(() => bridge.resumeAll!())}><RotateCcw className="size-4" />Resume all</Button>}
      </div>
    </div>
    {offline() && items.some((i) => !isPending(i)) && <p className="text-muted-foreground mb-2 flex items-center gap-2 text-xs"><WifiOff className="size-3.5" />Unfinished downloads continue when you reconnect to your server.</p>}
    <ul className="divide-y">{items.map((item) => <QueueRow key={item.id} item={item} refresh={refresh} now={now} />)}</ul>
  </section>;
}

/** A saved video, ready to play. */
function SavedCard({ item, refresh }: { item: OfflineDownload; refresh: () => Promise<void> }) {
  const [removing, setRemoving] = useState(false);
  const episode = episodeLabel(item.video.episode);
  return <article className="group/card relative flex flex-col gap-3">
    <Link to={downloadPath(item.id)} aria-label={`Play ${item.video.title}`} className="relative block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      <Thumbnail video={item.video} size="sm" className="rounded-xl" />
      <span aria-hidden className="absolute inset-0 grid place-items-center rounded-xl text-white opacity-0 transition-opacity group-hover/card:opacity-100"><span className="grid size-12 place-items-center rounded-full bg-black/60 backdrop-blur-sm"><Play className="size-5 translate-x-px fill-current" /></span></span>
    </Link>
    <Button variant="ghost" size="icon" className="absolute top-2 right-2 z-10 border-0 bg-black/70 text-white opacity-0 group-hover/card:opacity-100 hover:bg-black/90 hover:text-white focus-visible:opacity-100 dark:hover:bg-black/90" aria-label={`Remove ${item.video.title} from this device`} title="Remove from this device" onClick={() => setRemoving(true)}><Trash2 className="size-4" /></Button>
    <div className="min-w-0">
      <h3 className="line-clamp-2 text-sm font-semibold"><Link to={downloadPath(item.id)} className="hover:underline">{episode && <span className="text-muted-foreground mr-1.5 font-medium">{episode}</span>}{item.video.title}</Link></h3>
      <p className="text-muted-foreground mt-1 text-xs">{[item.quality.replace(/^Original · /, ""), fileSize(item.received), item.downloadedAt && `Saved ${new Date(item.downloadedAt).toLocaleDateString()}`].filter(Boolean).join(" · ")}</p>
      {item.warning && <p className="text-muted-foreground mt-1 text-xs">{item.warning}</p>}
    </div>
    <RemoveDownloadDialog item={item} open={removing} onOpenChange={setRemoving} onRemoved={refresh} />
  </article>;
}

function Storage({ library }: { library: DownloadLibrary }) {
  const other = Math.max(0, library.totalDiskBytes - library.freeBytes - library.usedBytes);
  const share = (bytes: number) => library.totalDiskBytes ? bytes / library.totalDiskBytes * 100 : 0;
  return <div className="bg-secondary/40 mb-8 space-y-3 rounded-xl border p-4 text-xs">
    <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-medium"><HardDrive className="size-4" />Device storage</span><span className="text-muted-foreground">{fileSize(library.freeBytes)} free of {fileSize(library.totalDiskBytes)}</span></div>
    <Progress
      className="h-2.5"
      aria-label="Device storage usage"
      aria-valuetext={`${fileSize(other)} other files, ${fileSize(library.usedBytes)} Fanoos downloads, ${fileSize(library.freeBytes)} free`}
      value={100 - share(library.freeBytes)}
      segments={[{ value: share(other), className: "bg-muted-foreground/50" }, { value: share(library.usedBytes), className: "bg-brand min-w-[3px]" }]}
    />
    <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2">
      <span className="inline-flex items-center gap-2"><span className="bg-brand size-2 rounded-full" />Fanoos downloads · {fileSize(library.usedBytes)}</span>
      <span className="inline-flex items-center gap-2"><span className="bg-muted-foreground/50 size-2 rounded-full" />Other files · {fileSize(other)}</span>
    </div>
  </div>;
}

export function DownloadsPage() {
  const { library, error, reload } = useDownloads();
  const [params] = useSearchParams();
  const group = params.get("group") ?? "";
  const saved = library?.items.filter((i) => i.status === "complete") ?? [];
  const allGroups = downloadGroups(saved);
  const selected = allGroups.find((g) => g.key === group);
  const groups = allGroups.filter((g) => !group || g.key === group);
  useTitle(selected ? `${selected.name} · Downloads` : "Downloads");
  const pending = (library?.items.filter((i) => i.status !== "complete") ?? []).filter((item) => !group || downloadGroups([item])[0]?.key === group).sort((a, b) => a.createdAt - b.createdAt);
  const bridge = downloadBridge();
  if (!bridge) return <div className="page"><PageHeader title="Downloads" description="Offline downloads are available in the Fanoos desktop app." /></div>;
  const savedBytes = (items: OfflineDownload[]) => fileSize(items.reduce((sum, item) => sum + item.received, 0));
  return <div className="page">
    {selected && <Link to="/downloads" className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-2 text-sm"><ArrowLeft className="size-4" />All downloads</Link>}
    <div className={cn("mb-8", selected && "flex items-center gap-5")}>
      {selected && <ChannelAvatar name={selected.name} src={selected.items[0]?.channel.avatar} className="size-20 shrink-0 sm:size-24" textClassName="text-2xl" />}
      <PageHeader
        title={selected?.name ?? "Downloads"}
        description={selected
          ? `${selected.items.length} saved ${selected.kind === "movies" ? selected.items.length === 1 ? "movie" : "movies" : selected.items.length === 1 ? "video" : "videos"} · ${formatDuration(selected.items.reduce((sum, item) => sum + item.video.duration, 0))} · ${savedBytes(selected.items)}`
          : saved.length ? `${saved.length} saved · ${savedBytes(saved)} on this device. Watch them anywhere, even without a connection.` : "Save videos, episodes and movies to watch without a connection."}
        actions={!selected && !offline() && saved.length > 0 && <Button variant="outline" className="rounded-full" onClick={() => void bridge.open()}><WifiOff className="size-4" />Open offline library</Button>}
      />
    </div>
    {error && <p role="alert" className="text-destructive mb-4 text-sm">{error}</p>}
    {!library && !error && <p role="status" className="text-muted-foreground flex items-center gap-2"><Spinner />Loading downloads…</p>}
    {library?.items.length === 0 && <Empty className="bg-card/40 rounded-2xl border py-20"><EmptyHeader><EmptyMedia variant="icon"><Download /></EmptyMedia><EmptyTitle>No downloads yet</EmptyTitle><EmptyDescription>While connected, open a YouTube video or a Plex movie or episode and choose Download. It appears here, ready to watch without your server.</EmptyDescription></EmptyHeader></Empty>}
    {pending.length > 0 && <Queue items={pending} refresh={reload} />}
    <div className="space-y-10">{groups.map((g) => <section key={g.key} aria-label={g.name}>
      <h2 className="font-display mb-4 text-xl font-semibold">{selected ? (g.kind === "show" ? "Episodes" : g.kind === "movies" ? "Movies" : "Videos") : <Link className="hover:text-brand transition-colors" to={`/downloads?group=${encodeURIComponent(g.key)}`}>{g.name}</Link>}<span className="text-muted-foreground ml-2 font-sans text-xs font-normal">{g.items.length} saved</span></h2>
      <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{g.items.map((item) => <SavedCard key={item.id} item={item} refresh={reload} />)}</div>
    </section>)}</div>
    {!!library?.items.length && !groups.length && !pending.length && <p role="status" className="text-muted-foreground py-8 text-center text-sm">No saved videos in this view.</p>}
    {library && library.items.length > 0 && !selected && <div className="mt-12"><Storage library={library} /></div>}
  </div>;
}
