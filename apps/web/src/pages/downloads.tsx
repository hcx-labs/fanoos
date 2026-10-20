import { useId, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router";
import { Search, Download, Play, Pause, RotateCcw, Trash2, HardDrive, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Thumbnail } from "@/components/video-card";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { useTitle } from "@/hooks/use-title";
import { downloadBridge, fileSize, useDownloads, downloadGroups, searchDownloads } from "@/lib/downloads";
import type { OfflineDownload } from "@/lib/types";

function DownloadRow({ item, refresh, card = false }: { item: OfflineDownload; refresh: () => Promise<void>; card?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await refresh(); }
    catch (e) { toast.error("Download action failed", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const bridge = downloadBridge()!;
  const navigate = useNavigate();
  const play = async () => { navigate(window.fanoosDesktop?.offline ? `/watch/${item.id}` : `/downloads/${item.id}`); };
  const active = item.status === "downloading" || item.status === "queued";
  const progress = item.total ? Math.min(100, item.received / item.total * 100) : 0;
  const thumbnail = window.fanoosDesktop?.offline && item.status !== "complete" ? "" : item.video.thumbnail;
  return <article className={cn("group/card flex gap-4", card ? "flex-col" : "bg-card/50 flex-col rounded-2xl border p-4 sm:flex-row")}>
    <div className={cn("bg-muted relative aspect-video w-full shrink-0 overflow-hidden rounded-xl", !card && "sm:w-44")}>
      {card ? <Thumbnail video={item.video} size="sm" /> : thumbnail ? <img src={thumbnail} alt="" className="size-full object-cover" /> : <div className="text-muted-foreground grid size-full place-items-center"><Download className="size-6" /></div>}
      {item.status === "complete" && <Button variant="ghost" className="absolute inset-0 h-full w-full rounded-none bg-black/10 p-0 text-white hover:bg-black/30" aria-label={`Play ${item.video.title}`} onClick={() => void action(play)}><Play className="size-9 drop-shadow" /></Button>}
    </div>
    <div className="min-w-0 flex-1">
      <h2 className="line-clamp-2 text-sm font-semibold">{item.video.title}</h2>
      {!card && <p className="text-muted-foreground mt-1 text-xs">{item.video.channelName}</p>}
      <p className="text-muted-foreground mt-2 text-xs">{item.quality} · {item.audio} · {fileSize(item.status === "complete" ? item.received : item.total)}</p>
      {item.downloadedAt && <p className="text-muted-foreground mt-1 text-xs">Downloaded {new Date(item.downloadedAt).toLocaleDateString()}</p>}
      {item.status !== "complete" && <div className="mt-3 flex items-center gap-2 text-xs" role="status">
        {item.status === "downloading" && <Spinner className="size-3" />}
        <span>{({ queued: "Queued", downloading: `Downloading · ${Math.round(progress)}%`, paused: "Paused", failed: "Download interrupted", complete: "Available offline" })[item.status]}</span>
        {active && <span className="text-muted-foreground">{fileSize(item.received)} of about {fileSize(item.total)}</span>}
      </div>}
      {active && <Progress aria-label="Download progress" value={progress} className="mt-2 h-1" />}
      {item.error && <p className="text-destructive mt-2 text-xs" role="alert">{item.error}</p>}
      {item.warning && <p className="text-muted-foreground mt-2 text-xs">{item.warning}</p>}
    </div>
    <div className={cn("flex shrink-0 items-center gap-1 self-start", !card && "sm:self-center")}>
      {item.status === "complete" ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => void action(play)}><Play className="size-4" />Play</Button>
        : active ? <Button variant="ghost" size="icon" aria-label={`Pause ${item.video.title}`} disabled={busy} onClick={() => void action(() => bridge.pause(item.id))}><Pause className="size-4" /></Button>
        : <Button variant="secondary" size="sm" disabled={busy || !!window.fanoosDesktop?.offline} onClick={() => void action(() => bridge.resume(item.id))}><RotateCcw className="size-4" />Resume</Button>}
      <Button variant="ghost" size="icon" aria-label={`${active ? "Cancel" : "Remove"} ${item.video.title}`} disabled={busy} onClick={() => {
        if (item.status === "complete") setRemoveOpen(true);
        else void action(() => bridge.remove(item.id));
      }}><Trash2 className="size-4" /></Button>
    </div>
    <Dialog open={removeOpen} onOpenChange={(open) => !busy && setRemoveOpen(open)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Remove download?</DialogTitle><DialogDescription>This removes “{item.video.title}” from this device. You can download it again while connected.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRemoveOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void action(() => bridge.remove(item.id))}>Remove download</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </article>;
}

export function DownloadsPage() {
  const { library, error, reload } = useDownloads();
  const storageId = useId();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const group = params.get("group") ?? "";
  const allGroups = downloadGroups(library?.items.filter((i) => i.status === "complete") ?? []);
  const groups = downloadGroups(searchDownloads(library?.items.filter((i) => i.status === "complete") ?? [], query)).filter((g) => !group || g.key === group);
  const selected = allGroups.find((g) => g.key === group);
  useTitle(selected ? `${selected.name} · Downloads` : "Downloads");
  const pending = searchDownloads(library?.items.filter((i) => i.status !== "complete") ?? [], query).filter((item) => !group || downloadGroups([item])[0]?.key === group);
  const bridge = downloadBridge();
  if (!bridge) return <div className="page"><PageHeader title="Downloads" description="Offline downloads are available in the Fanoos desktop app." /></div>;
  const setLimit = async (value: string) => {
    setSaving(true);
    try { await bridge.limit(Number(value) * 1024 ** 3); await reload(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  return <div className="page">
    {selected && <Link to="/downloads" className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-2 text-sm"><ArrowLeft className="size-4" />All downloads</Link>}
    <div className={cn(selected && "mb-8 flex items-center gap-5")}>
    {selected && <ChannelAvatar name={selected.name} src={selected.items[0]?.channel.avatar} className="size-20 shrink-0 sm:size-24" textClassName="text-2xl" />}
    <PageHeader
      className={selected ? "" : "mb-6"}
      title={selected?.name ?? "Downloads"}
      eyebrow={selected ? selected.items[0]?.video.episode ? "Downloaded show" : "Downloaded channel" : undefined}
      description={selected ? `${selected.items.length} saved ${selected.items.length === 1 ? "video" : "videos"} · ${formatDuration(selected.items.reduce((sum, item) => sum + item.video.duration, 0))} · ${fileSize(selected.items.reduce((sum, item) => sum + item.received, 0))}` : "Your videos, ready to watch offline."}
      actions={!selected && !window.fanoosDesktop?.offline && <Button variant="outline" className="rounded-full" onClick={() => void bridge.open()}><HardDrive className="size-4" />Open offline library</Button>}
    />
    </div>
    {error && <p role="alert" className="text-destructive mb-4 text-sm">{error}</p>}
    {library && !selected && <div className="bg-secondary/40 mb-6 grid gap-5 rounded-xl border p-4 text-xs sm:grid-cols-2">
      <div className="space-y-2"><div className="flex items-center justify-between gap-3"><span className="font-medium">Offline storage</span><span className="text-muted-foreground">{fileSize(library.usedBytes)} of {fileSize(library.limitBytes)}</span></div><Progress aria-label="Offline storage usage" value={library.usedBytes / library.limitBytes * 100} /><span className="text-muted-foreground block">{Math.round(library.usedBytes / library.limitBytes * 100)}% of download limit used</span></div>
      <div className="space-y-2"><div className="flex items-center justify-between gap-3"><span className="font-medium">Device disk</span><span className="text-muted-foreground">{fileSize(Math.max(0, library.totalDiskBytes - library.freeBytes))} of {fileSize(library.totalDiskBytes)}</span></div><Progress aria-label="Device disk usage" value={library.totalDiskBytes ? (1 - library.freeBytes / library.totalDiskBytes) * 100 : 0} /><span className="text-muted-foreground block">{fileSize(library.freeBytes)} available</span></div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Label htmlFor={storageId} className="text-muted-foreground text-xs font-normal">Device storage limit</Label>
        <Select value={String(Math.round(library.limitBytes / 1024 ** 3))} disabled={saving} onValueChange={(value) => void setLimit(value)}>
          <SelectTrigger id={storageId} size="sm" className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{[...new Set([5, 10, 20, 50, 100, Math.round(library.limitBytes / 1024 ** 3)])].sort((a,b) => a-b).map((gb) => <SelectItem key={gb} value={String(gb)}>{gb} GB</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>}
    {!library && !error && <p role="status" className="text-muted-foreground">Loading downloads…</p>}
    {library?.items.length === 0 && <Empty className="bg-card/40 rounded-2xl border py-20"><EmptyHeader><EmptyMedia variant="icon"><Download /></EmptyMedia><EmptyTitle>No downloads yet</EmptyTitle><EmptyDescription>Open a YouTube video while connected and choose Download. Saved videos will appear here, ready to watch without your server.</EmptyDescription></EmptyHeader></Empty>}
    {!!library?.items.length && <div className="mb-6 flex flex-wrap gap-3">
      <InputGroup className="h-9 min-w-48 flex-1 rounded-full">
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput aria-label="Search downloads" placeholder={selected ? `Search ${selected.name} downloads` : "Search your downloads"} value={query} onChange={(e) => setQuery(e.target.value)} />
      </InputGroup>

    </div>}
    {pending.length > 0 && <section className="mb-8 space-y-3"><h2 className="font-display mb-4 text-xl font-semibold">Download queue <span className="text-muted-foreground ml-2 font-sans text-xs font-normal">{pending.length}</span></h2>{pending.map((item) => <DownloadRow key={item.id} item={item} refresh={reload} />)}</section>}
    <div className="space-y-8">{groups.map((g) => <section key={g.key} aria-label={g.name}><h2 className="font-display mb-4 text-xl font-semibold">{selected ? "Videos" : g.name}<span className="text-muted-foreground ml-2 font-sans text-xs font-normal">{g.items.length} saved</span></h2><div className={selected ? "grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : "space-y-3"}>{g.items.map((item) => <DownloadRow key={item.id} item={item} refresh={reload} card={!!selected} />)}</div></section>)}</div>
    {!!library?.items.length && !groups.length && !pending.length && <p role="status" className="text-muted-foreground py-8 text-center text-sm">No downloads match your search.</p>}

  </div>;
}
