import { useId, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { captionId, downloadBridge, fileSize } from "@/lib/downloads";
import type { DownloadPlan, DownloadTrack, Video } from "@/lib/types";

const playable = (t: DownloadTrack) => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(`${t.mimeType}; codecs="${t.codecs}"`);

export function DownloadButton({ video }: { video: Video }) {
  const formId = useId();
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
        {busy && !plan && <p className="text-muted-foreground flex items-center gap-2 py-4"><Spinner />Finding available tracks…</p>}
        {plan && <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-quality`}>Video quality</Label>
            <Select value={videoTrack} disabled={busy} onValueChange={setVideoTrack}>
              <SelectTrigger id={`${formId}-quality`} className="w-full"><SelectValue placeholder="Choose quality" /></SelectTrigger>
              <SelectContent>{videos.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-audio`}>Audio</Label>
            <Select value={audioTrack} disabled={busy} onValueChange={setAudioTrack}>
              <SelectTrigger id={`${formId}-audio`} className="w-full"><SelectValue placeholder="Choose audio" /></SelectTrigger>
              <SelectContent>{audios.map((t) => <SelectItem key={t.id} value={t.id}>{t.label} · {t.codecs.split(".")[0]} · {Math.round(t.bandwidth / 1000)} kbps</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {plan.subtitles.some((s) => s.format === "vtt") && <fieldset className="max-h-36 space-y-3 overflow-y-auto"><legend className="mb-2 text-sm font-medium">Captions</legend>{plan.subtitles.filter((s) => s.format === "vtt").map((s, index) => <div key={captionId(s)} className="flex items-center gap-2">
            <Checkbox id={`${formId}-caption-${index}`} disabled={busy} checked={captions.includes(captionId(s))} onCheckedChange={(checked) => setCaptions((old) => checked === true ? [...old, captionId(s)] : old.filter((key) => key !== captionId(s)))} />
            <Label htmlFor={`${formId}-caption-${index}`} className="font-normal">{s.label}</Label>
          </div>)}</fieldset>}
          <p className="text-muted-foreground text-xs">About {fileSize(bytes)} · Saved on this device for your Fanoos profile.</p>
        </div>}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <DialogFooter><Button disabled={busy || !videoTrack || !audioTrack || !plan} onClick={() => void save()}>{busy ? "Preparing…" : "Download"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
