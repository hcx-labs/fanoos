import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { captionId, downloadBridge, fileSize } from "@/lib/downloads";
import type { DownloadPlan, DownloadTrack, Video } from "@/lib/types";

const playable = (t: DownloadTrack) => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(`${t.mimeType}; codecs="${t.codecs}"`);
const selectClass = "bg-secondary text-foreground w-full rounded-lg border px-3 py-2 text-sm";

export function DownloadButton({ video }: { video: Video }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<DownloadPlan | null>(null);
  const [videoTrack, setVideoTrack] = useState("");
  const [audioTrack, setAudioTrack] = useState("");
  const [captions, setCaptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bridge = downloadBridge();
  if (!bridge || video.backend !== "youtube" || video.live || video.upcoming) return null;
  const videos = plan?.tracks.filter((t) => t.kind === "video" && playable(t)).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth) ?? [];
  const audios = plan?.tracks.filter((t) => t.kind === "audio" && playable(t)) ?? [];
  const selected = plan?.tracks.filter((t) => t.id === videoTrack || t.id === audioTrack) ?? [];
  const bytes = selected.reduce((n, t) => n + (t.bytes ?? t.bandwidth * (plan?.duration ?? 0) / 8), 0);
  const begin = async () => {
    setOpen(true); setBusy(true); setError(null); setPlan(null); setCaptions([]);
    try {
      const next = await bridge.plan(video.id);
      const v = next.tracks.filter((t) => t.kind === "video" && playable(t)).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (/avc1/.test(a.codecs) ? -1 : 1));
      const a = next.tracks.filter((t) => t.kind === "audio" && playable(t));
      setVideoTrack((v.find((t) => (t.height ?? 0) <= 1080) ?? v[0])?.id ?? "");
      setAudioTrack((a.find((t) => t.default) ?? a[0])?.id ?? "");
      setPlan(next);
      if (!v.length || !a.length) setError("No downloadable tracks supported by this device.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await bridge.add({ videoId: video.id, videoTrack, audioTrack, subtitles: captions });
      setOpen(false); toast.success("Added to Downloads", { description: "The download continues while you browse Fanoos." });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <>
    <Button variant="secondary" className="rounded-full" onClick={() => void begin()}><Download className="size-4" />Download</Button>
    <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Download for offline viewing</DialogTitle><DialogDescription className="truncate">{video.title}</DialogDescription></DialogHeader>
        {busy && !plan && <p className="text-muted-foreground flex items-center gap-2 py-4"><LoaderCircle className="size-4 animate-spin" />Finding available tracks…</p>}
        {plan && <div className="space-y-4">
          <label className="block space-y-2"><span>Video quality</span><select className={selectClass} value={videoTrack} disabled={busy} onChange={(e) => setVideoTrack(e.target.value)}>{videos.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <label className="block space-y-2"><span>Audio</span><select className={selectClass} value={audioTrack} disabled={busy} onChange={(e) => setAudioTrack(e.target.value)}>{audios.map((t) => <option key={t.id} value={t.id}>{t.label} · {t.codecs.split(".")[0]} · {Math.round(t.bandwidth / 1000)} kbps</option>)}</select></label>
          {plan.subtitles.length > 0 && <fieldset className="max-h-36 space-y-2 overflow-y-auto"><legend className="mb-2">Captions</legend>{plan.subtitles.filter((s) => s.format === "vtt").map((s) => <label key={captionId(s)} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={captions.includes(captionId(s))} onChange={(e) => setCaptions((old) => e.target.checked ? [...old, captionId(s)] : old.filter((key) => key !== captionId(s)))} />{s.label}</label>)}</fieldset>}
          <p className="text-muted-foreground text-xs">About {fileSize(bytes)} · Saved on this device for your Fanoos profile.</p>
        </div>}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <DialogFooter><Button disabled={busy || !videoTrack || !audioTrack || !plan} onClick={() => void save()}>{busy ? "Preparing…" : "Download"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
