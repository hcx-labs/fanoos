import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { canDownload, captionId, conversionsOf, downloadBridge, downloadPath, fileSize, isPending, useDownloadOf } from "@/lib/downloads";
import { cn } from "@/lib/utils";
import type { DownloadConversion, DownloadFile, DownloadPlan, DownloadTrack, OfflineDownload, Video } from "@/lib/types";

const playable = (t: DownloadTrack) => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(`${t.mimeType}; codecs="${t.codecs}"`);
export const sizeOf = (t: DownloadTrack | undefined, duration: number) => t ? t.bytes ?? t.bandwidth * duration / 8 : 0;
const family = (codecs: string) => /^av01/.test(codecs) ? "AV1" : /^vp0?9/.test(codecs) ? "VP9" : /^avc1/.test(codecs) ? "H.264" : /^mp4a/.test(codecs) ? "AAC" : /^opus/.test(codecs) ? "Opus" : codecs.split(".")[0]!.toUpperCase();

// The last quality and subtitle languages chosen, so the next download starts from them.
const PREFS_KEY = "fanoos.download-preferences";
type Prefs = { height?: number; subtitles?: string[]; audio?: string; conversion?: string };
export function readPrefs(): Prefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs; } catch { return {}; }
}
export function writePrefs(prefs: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...prefs })); } catch {}
}

/** Remembered per language, with forced tracks (signs and foreign lines only) as their own choice. */
const subtitlePref = (s: { locale: string; label: string }) => `${s.locale}${/forced/i.test(s.label) ? ":forced" : ""}`;

/** Whether the device decodes this codec in hardware, as the player decides for streaming. */
async function efficient(contentType: string) {
  try {
    const info = await navigator.mediaCapabilities.decodingInfo({ type: "media-source", video: { contentType, width: 1920, height: 1080, bitrate: 5_000_000, framerate: 30 } });
    return info.supported && info.smooth && info.powerEfficient;
  } catch { return false; }
}

export type Quality = { key: string; label: string; height: number; track: DownloadTrack };

/**
 * One choice per resolution and frame rate. Each uses the smallest codec this device decodes
 * efficiently (AV1, then VP9), falling back to H.264, which plays everywhere.
 */
export async function qualities(tracks: DownloadTrack[]): Promise<Quality[]> {
  const [av1, vp9] = await Promise.all([efficient('video/mp4; codecs="av01.0.08M.08"'), efficient('video/webm; codecs="vp09.00.40.08"')]);
  const rank = (t: DownloadTrack) => /^av01/.test(t.codecs) ? (av1 ? 0 : 3) : /^vp0?9/.test(t.codecs) ? (vp9 ? 1 : 4) : /^avc1/.test(t.codecs) ? 2 : 5;
  const best = new Map<string, DownloadTrack>();
  for (const t of tracks.filter((t) => t.kind === "video" && playable(t))) {
    const key = `${t.height ?? 0}|${(t.fps ?? 30) > 30 ? t.fps : ""}`;
    const old = best.get(key);
    if (!old || rank(t) < rank(old) || (rank(t) === rank(old) && t.bandwidth > old.bandwidth)) best.set(key, t);
  }
  return [...best.entries()].map(([key, track]) => ({ key, track, height: track.height ?? 0, label: `${track.height}p${(track.fps ?? 30) > 30 ? track.fps : ""}` }))
    .sort((a, b) => b.height - a.height || (b.track.fps ?? 0) - (a.track.fps ?? 0));
}

/** Audio by language: the highest-bitrate playable track for each label. */
export function audioChoices(tracks: DownloadTrack[]) {
  const best = new Map<string, DownloadTrack>();
  for (const t of tracks.filter((t) => t.kind === "audio" && playable(t))) {
    const old = best.get(t.label);
    if (!old || t.bandwidth > old.bandwidth) best.set(t.label, t);
  }
  return [...best.values()].sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false) || a.label.localeCompare(b.label));
}

/** Audio tracks of server conversions, one each, the file's default first. */
export function conversionAudios(conversions: DownloadConversion[]) {
  return [...new Map(conversions.map((c) => [c.audio.id, c.audio])).values()].sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false));
}
/** The remembered language if there's one like it, else the file's default track. */
export const preferredAudio = (audios: DownloadConversion["audio"][], prefs: Prefs) => audios.find((a) => prefs.audio && a.locale === prefs.audio) ?? audios[0];
export const preferredConversion = (conversions: DownloadConversion[], audio: string | undefined, prefs: Prefs) => {
  const options = conversions.filter((c) => c.audio.id === audio);
  return options.find((c) => c.quality.id === prefs.conversion) ?? options.find((c) => c.quality.copy) ?? options[0];
};

/** Offers saving a video for offline viewing; once queued or saved, shows and manages that download. */
export function DownloadButton({ video }: { video: Video }) {
  const { item, library, reload } = useDownloadOf(video);
  const [open, setOpen] = useState(false);
  if (!canDownload(video)) return null;
  if (item) return <DownloadStatus item={item} refresh={reload} />;
  return <>
    <Button variant="secondary" className="rounded-full" onClick={() => setOpen(true)}><Download className="size-4" />Download</Button>
    {open && <DownloadDialog video={video} freeBytes={library?.freeBytes} onClose={() => setOpen(false)} />}
  </>;
}

function DownloadStatus({ item, refresh }: { item: OfflineDownload; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const bridge = downloadBridge()!;
  const [removing, setRemoving] = useState(false);
  const progress = item.total ? Math.min(100, Math.round(item.received / item.total * 100)) : 0;
  const act = (work: () => Promise<unknown>) => void work().then(refresh).catch((e: Error) => toast.error("Download action failed", { description: e.message }));
  const label = { complete: "Downloaded", downloading: `Downloading · ${progress}%`, queued: item.retryAt ? "Retrying soon" : "Queued", paused: `Paused · ${progress}%`, failed: "Download failed" }[item.status];
  const Icon = { complete: CheckCircle2, downloading: Spinner, queued: Download, paused: Pause, failed: AlertTriangle }[item.status];
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className={cn("relative overflow-hidden rounded-full", item.status === "failed" && "text-destructive")}>
          {isPending(item) && <span aria-hidden className="bg-brand/20 absolute inset-y-0 left-0 transition-[width]" style={{ width: `${progress}%` }} />}
          <Icon className="relative size-4" /><span className="relative">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">{item.quality} · {fileSize(item.status === "complete" ? item.received : item.total)}{item.error ? ` · ${item.error}` : ""}</DropdownMenuLabel>
        {item.status === "complete" && <DropdownMenuItem onSelect={() => navigate(downloadPath(item.id))}><Play />Play downloaded copy</DropdownMenuItem>}
        {isPending(item) && <DropdownMenuItem onSelect={() => act(() => bridge.pause(item.id))}><Pause />Pause</DropdownMenuItem>}
        {(item.status === "paused" || item.status === "failed") && <DropdownMenuItem onSelect={() => act(() => bridge.resume(item.id))}><RotateCcw />{item.status === "failed" ? "Retry" : "Resume"}</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => navigate("/downloads")}><FolderOpen />All downloads</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => item.status === "complete" ? setRemoving(true) : act(() => bridge.remove(item.id))}><Trash2 />{item.status === "complete" ? "Remove from this device" : "Cancel download"}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <RemoveDownloadDialog item={item} open={removing} onOpenChange={setRemoving} onRemoved={refresh} />
  </>;
}

export function RemoveDownloadDialog({ item, open, onOpenChange, onRemoved }: { item: OfflineDownload; open: boolean; onOpenChange: (open: boolean) => void; onRemoved?: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try { await downloadBridge()!.remove(item.id); onOpenChange(false); await onRemoved?.(); toast.success("Download removed", { description: `${fileSize(item.received)} freed on this device.` }); }
    catch (e) { toast.error("Couldn't remove the download", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
    <DialogContent>
      <DialogHeader><DialogTitle>Remove download?</DialogTitle><DialogDescription>This removes “{item.video.title}” from this device and frees {fileSize(item.received)}. You can download it again while connected.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy && <Spinner />}Remove download</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function DownloadDialog({ video, freeBytes, onClose }: { video: Video; freeBytes?: number; onClose: () => void }) {
  const formId = useId();
  const navigate = useNavigate();
  const backend = video.backend ?? "youtube";
  const [plan, setPlan] = useState<DownloadPlan | null>(null);
  const [options, setOptions] = useState<Quality[]>([]);
  const [quality, setQuality] = useState("");
  const [audioTrack, setAudioTrack] = useState("");
  const [file, setFile] = useState<DownloadFile | null>(null);
  const [conversion, setConversion] = useState("");
  const [captions, setCaptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bridge = downloadBridge()!;
  useEffect(() => {
    let live = true;
    // Older desktop builds take only a YouTube id.
    void bridge.plan(bridge.backends ? { backend, videoId: video.id } : video.id).then(async (next) => {
      const prefs = readPrefs();
      const choices = await qualities(next.tracks);
      if (!live) return;
      const audios = audioChoices(next.tracks);
      const preferred = choices.find((q) => q.height <= (prefs.height ?? 1080)) ?? choices.at(-1);
      setOptions(choices);
      setQuality(preferred?.key ?? "");
      setAudioTrack(audios[0]?.id ?? "");
      setFile(next.files?.[0] ?? null);
      const conversions = conversionsOf(next);
      setConversion(preferredConversion(conversions, preferredAudio(conversionAudios(conversions), prefs)?.id, prefs)?.id ?? "");
      const texts = next.subtitles.filter((s) => (s.format === "vtt" || s.format === "ass") && s.render !== "server");
      setCaptions(texts.filter((s) => prefs.subtitles?.includes(subtitlePref(s)) && !s.autoGenerated).map((s) => captionId(s, backend)));
      setPlan(next);
      if (!next.files?.length && !conversions.length && (!choices.length || !audios.length)) setError("This device can't play any of the available formats offline.");
    }).catch((e: Error) => live && setError(e.message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [bridge, backend, video.id]);
  const audios = plan ? audioChoices(plan.tracks) : [];
  const selected = options.find((q) => q.key === quality);
  const subtitles = plan?.subtitles.filter((s) => (s.format === "vtt" || s.format === "ass") && s.render !== "server") ?? [];
  const audioBytes = sizeOf(audios.find((t) => t.id === audioTrack), plan?.duration ?? 0);
  const conversions = plan ? conversionsOf(plan) : [];
  const chosen = conversions.find((c) => c.id === conversion);
  const convAudios = conversionAudios(conversions);
  const convSize = (c: DownloadConversion) => c.bitrate * (plan?.duration ?? 0) / 8;
  const bytes = chosen ? convSize(chosen) : file && !options.length ? file.bytes : sizeOf(selected?.track, plan?.duration ?? 0) + audioBytes;
  const tooBig = freeBytes !== undefined && bytes + 64 * 1024 ** 2 > freeBytes;
  const ready = Boolean(plan && (chosen || (file && !options.length) || (selected && audioTrack)));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await bridge.add(chosen
        ? { backend, videoId: video.id, conversion: chosen.id, subtitles: captions }
        : file && !options.length
        ? { backend, videoId: video.id, file: file.id, subtitles: captions }
        : { backend, videoId: video.id, videoTrack: selected!.track.id, audioTrack, subtitles: captions });
      writePrefs({ ...(chosen ? { audio: chosen.audio.locale, conversion: chosen.quality.id } : { height: selected?.height }), subtitles: [...new Set(subtitles.filter((s) => captions.includes(captionId(s, backend))).map(subtitlePref))] });
      onClose();
      toast.success("Added to Downloads", { description: "It keeps downloading while you browse.", action: { label: "View", onClick: () => navigate("/downloads") } });
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return <Dialog open onOpenChange={(value) => !busy && !value && onClose()}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Download for offline viewing</DialogTitle><DialogDescription className="line-clamp-2">{video.title}</DialogDescription></DialogHeader>
      {busy && !plan && <p role="status" className="text-muted-foreground flex items-center gap-2 py-6"><Spinner />Checking available formats…</p>}
      {plan && <div className="space-y-5">
        {options.length > 0 && <fieldset>
          <legend className="mb-2 text-sm font-medium">Quality</legend>
          <div role="radiogroup" aria-label="Quality" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {options.map((q) => <button key={q.key} type="button" role="radio" aria-checked={q.key === quality} disabled={busy} onClick={() => setQuality(q.key)}
              className={cn("hover:bg-muted flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50", q.key === quality && "border-brand bg-brand/10 hover:bg-brand/10")}>
              <span className="text-sm font-semibold">{q.label}</span>
              <span className="text-muted-foreground text-xs tabular-nums">{fileSize(sizeOf(q.track, plan.duration) + audioBytes)}</span>
            </button>)}
          </div>
          {selected && <p className="text-muted-foreground mt-2 text-xs">{family(selected.track.codecs)} video, chosen for this device.</p>}
        </fieldset>}
        {conversions.length > 0 && <>
          {convAudios.length > 1 && <div className="space-y-2">
            <Label htmlFor={`${formId}-audio`}>Audio</Label>
            <Select value={chosen?.audio.id ?? ""} disabled={busy} onValueChange={(id) => setConversion(preferredConversion(conversions, id, { conversion: chosen?.quality.id })?.id ?? "")}>
              <SelectTrigger id={`${formId}-audio`} className="w-full"><SelectValue placeholder="Choose audio" /></SelectTrigger>
              <SelectContent>{convAudios.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}{a.default ? " · Default" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Quality</legend>
            <div role="radiogroup" aria-label="Quality" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {conversions.filter((c) => c.audio.id === chosen?.audio.id).map((c) => <button key={c.id} type="button" role="radio" aria-checked={c.id === conversion} disabled={busy} onClick={() => setConversion(c.id)}
                className={cn("hover:bg-muted flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50", c.id === conversion && "border-brand bg-brand/10 hover:bg-brand/10")}>
                <span className="text-sm font-semibold">{c.quality.label}</span>
                <span className="text-muted-foreground text-xs tabular-nums">~{fileSize(convSize(c))}</span>
              </button>)}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">{chosen?.quality.copy ? `Keeps the original ${chosen.quality.codec?.toUpperCase() ?? ""} video untouched.` : "Your Plex server converts the video to H.264 while it downloads, which is slower than Original on servers without hardware transcoding."} Audio is converted to AAC stereo so it plays everywhere.</p>
          </fieldset>
        </>}
        {!conversions.length && file && !options.length && <div className="bg-secondary/40 space-y-1 rounded-xl border p-3">
          <p className="text-sm font-semibold">{file.label} · {fileSize(file.bytes)}</p>
          <p className="text-muted-foreground text-xs">{[file.container.toUpperCase(), file.videoCodec?.toUpperCase(), file.audioCodec?.toUpperCase()].filter(Boolean).join(" · ")}</p>
          <p className="text-muted-foreground text-xs">The original file is saved as it is, without conversion. Offline playback uses its default audio{file.audio ? ` (${file.audio})` : ""}.</p>
        </div>}
        {audios.length > 1 && <div className="space-y-2">
          <Label htmlFor={`${formId}-audio`}>Audio</Label>
          <Select value={audioTrack} disabled={busy} onValueChange={setAudioTrack}>
            <SelectTrigger id={`${formId}-audio`} className="w-full"><SelectValue placeholder="Choose audio" /></SelectTrigger>
            <SelectContent>{audios.map((t) => <SelectItem key={t.id} value={t.id}>{t.label} · {family(t.codecs)} {Math.round(t.bandwidth / 1000)} kbps</SelectItem>)}</SelectContent>
          </Select>
        </div>}
        {subtitles.length > 0 && <fieldset>
          <legend className="mb-2 text-sm font-medium">{backend === "youtube" ? "Captions" : "Subtitles"}</legend>
          <div className="max-h-40 space-y-2.5 overflow-y-auto pr-1">{subtitles.map((s, index) => <div key={captionId(s, backend)} className="flex items-center gap-2">
            <Checkbox id={`${formId}-caption-${index}`} disabled={busy} checked={captions.includes(captionId(s, backend))} onCheckedChange={(checked) => setCaptions((old) => checked === true ? [...old, captionId(s, backend)] : old.filter((key) => key !== captionId(s, backend)))} />
            <Label htmlFor={`${formId}-caption-${index}`} className="font-normal">{s.label}{s.autoGenerated && <span className="text-muted-foreground">(auto-generated)</span>}</Label>
          </div>)}</div>
        </fieldset>}
        <p className={cn("text-xs", tooBig ? "text-destructive" : "text-muted-foreground")}>
          About {fileSize(bytes)}{freeBytes !== undefined && ` · ${fileSize(freeBytes)} free on this device`}
          {tooBig && ". Free up some space to download this quality."}
        </p>
      </div>}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy && !!plan} onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !ready || tooBig} onClick={() => void save()}>{busy && plan ? <><Spinner />Adding…</> : <><Download className="size-4" />Download</>}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
