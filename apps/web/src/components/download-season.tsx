import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import { CheckCircle2, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { audioChoices, qualities, readPrefs, sizeOf, writePrefs } from "@/components/download-button";
import { canDownload, captionId, conversionsOf, downloadBridge, fileSize, useDownloads } from "@/lib/downloads";
import { useSource } from "@/lib/source";
import { cn } from "@/lib/utils";
import type { Channel, DownloadPlan, DownloadSelection, Subtitle, Video } from "@/lib/types";

const languages = (() => { try { return new Intl.DisplayNames([navigator.language, "en"], { type: "language" }); } catch { return null; } })();
const languageName = (locale: string) => { if (locale === "und") return "Unknown language"; try { return languages?.of(locale) ?? locale; } catch { return locale; } };
const textSubtitles = (plan: DownloadPlan) => plan.subtitles.filter((s) => (s.format === "vtt" || s.format === "ass") && s.render !== "server");
// Forced subtitles carry only signs and foreign-language lines; they're a separate choice from the full track.
const forced = (s: Subtitle) => /forced/i.test(s.label);
const subtitleKind = (s: Subtitle) => `${s.locale}${forced(s) ? ":forced" : ""}`;
const subtitleKindLabel = (kind: string) => { const [locale, flag] = kind.split(":"); return `${languageName(locale!)}${flag ? " · Forced" : ""}`; };

/** Fallback for plans without server conversions: the original file, or tracks at the remembered height. */
type Fixed = Omit<DownloadSelection, "subtitles"> & { bytes: number };
type Planned = { video: Video; plan?: DownloadPlan; fixed?: Fixed; error?: string };

async function fixedChoice(video: Video, plan: DownloadPlan, height: number | undefined): Promise<Fixed | undefined> {
  const backend = video.backend ?? "youtube";
  const file = plan.files?.[0];
  if (file) return { backend, videoId: video.id, file: file.id, bytes: file.bytes };
  const quality = (await qualities(plan.tracks)).find((q) => q.height <= (height ?? 1080));
  const audio = audioChoices(plan.tracks)[0];
  return quality && audio ? { backend, videoId: video.id, videoTrack: quality.track.id, audioTrack: audio.id, bytes: sizeOf(quality.track, plan.duration) + sizeOf(audio, plan.duration) } : undefined;
}

/** What an episode saves for the season's choices; the episode's own default audio where the language is missing. */
function selectionFor(e: Planned, audio: string, quality: string): (Omit<DownloadSelection, "subtitles"> & { bytes: number; fallback?: boolean }) | undefined {
  const conversions = e.plan ? conversionsOf(e.plan) : [];
  if (!conversions.length) return e.fixed;
  const exact = conversions.find((c) => c.audio.locale === audio && c.quality.id === quality);
  const match = exact ?? conversions.find((c) => c.audio.default && c.quality.id === quality) ?? conversions.find((c) => c.audio.default && c.quality.copy) ?? conversions[0]!;
  return { backend: e.video.backend, videoId: e.video.id, conversion: match.id, bytes: match.bitrate * e.plan!.duration / 8, fallback: !exact };
}

/** "Download season" on a show page: every episode of the selected season, queued in order. */
export function DownloadSeasonButton({ show, section, label }: { show: Channel; section?: string; label?: string }) {
  const { library } = useDownloads();
  const [open, setOpen] = useState(false);
  if (!canDownload({ backend: show.backend })) return null;
  return <>
    <Button variant="outline" className="rounded-full px-4" onClick={() => setOpen(true)}><Download />{label ? `Download ${label}` : "Download season"}</Button>
    {open && <SeasonDialog show={show} section={section} label={label} freeBytes={library?.freeBytes} saved={new Set(library?.items.filter((i) => (i.backend ?? i.video.backend) === show.backend).map((i) => i.videoId))} onClose={() => setOpen(false)} />}
  </>;
}

function SeasonDialog({ show, section, label, freeBytes, saved, onClose }: { show: Channel; section?: string; label?: string; freeBytes?: number; saved: Set<string>; onClose: () => void }) {
  const formId = useId();
  const source = useSource();
  const navigate = useNavigate();
  const backend = show.backend ?? "youtube";
  const [episodes, setEpisodes] = useState<Planned[] | null>(null);
  const [planned, setPlanned] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [audio, setAudio] = useState("");
  const [quality, setQuality] = useState("");
  const [subtitleKinds, setSubtitleKinds] = useState<string[]>([]);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const bridge = downloadBridge()!;
    void (async () => {
      // The whole season, page by page.
      let page = await source.channel({ backend, id: show.id }, section, { signal: abort.signal, limit: 100 });
      const videos = [...page.videos];
      while (page.next && !abort.signal.aborted) {
        page = await source.channel({ backend, id: show.id }, section, { next: page.next, signal: abort.signal, limit: 100 });
        videos.push(...page.videos);
      }
      if (abort.signal.aborted) return;
      const prefs = readPrefs();
      const results: Planned[] = videos.map((video) => ({ video }));
      setEpisodes([...results]);
      // A few plans at a time: each asks the media server about one episode.
      let next = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < videos.length && !abort.signal.aborted) {
          const index = next++;
          const video = videos[index]!;
          try {
            if (!saved.has(video.id)) {
              const plan = await bridge.plan({ backend, videoId: video.id });
              const fixed = conversionsOf(plan).length ? undefined : await fixedChoice(video, plan, prefs.height);
              results[index] = { video, plan, fixed, error: conversionsOf(plan).length || fixed ? undefined : "No format this device can play offline." };
            }
          } catch (e) { results[index] = { video, error: (e as Error).message }; }
          if (abort.signal.aborted) return;
          setEpisodes([...results]);
          setPlanned((n) => n + 1);
        }
      }));
      if (abort.signal.aborted) return;
      const conversions = results.flatMap((r) => r.plan ? conversionsOf(r.plan) : []);
      // Start from what was chosen last time, if this season has it; else each file's default.
      const locales = new Set(conversions.map((c) => c.audio.locale));
      const defaults = conversions.filter((c) => c.audio.default).map((c) => c.audio.locale);
      setAudio(prefs.audio && locales.has(prefs.audio) ? prefs.audio : defaults[0] ?? "");
      const qualityIds = new Set(conversions.map((c) => c.quality.id));
      setQuality(prefs.conversion && qualityIds.has(prefs.conversion) ? prefs.conversion : conversions.find((c) => c.quality.copy)?.quality.id ?? conversions[0]?.quality.id ?? "");
      setChosen(new Set(results.filter((r) => r.plan && !r.error).map((r) => r.video.id)));
      const kinds = new Set(results.flatMap((r) => r.plan ? textSubtitles(r.plan).map(subtitleKind) : []));
      setSubtitleKinds((prefs.subtitles ?? []).filter((l) => kinds.has(l)));
    })().catch((e: Error) => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
    // `saved` is read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, backend, show.id, section]);

  const ready = episodes !== null && planned === episodes.length;
  const pending = episodes?.filter((e) => !saved.has(e.video.id)) ?? [];
  const available = pending.filter((e) => e.plan && !e.error);
  const selected = available.filter((e) => chosen.has(e.video.id));
  const conversions = pending.flatMap((e) => e.plan ? conversionsOf(e.plan) : []);
  const audioOptions = [...new Set(conversions.map((c) => c.audio.locale))];
  const qualityOptions = [...new Map(conversions.map((c) => [c.quality.id, c.quality])).values()];
  const choices = new Map(available.map((e) => [e.video.id, selectionFor(e, audio, quality)]));
  const bytes = selected.reduce((n, e) => n + (choices.get(e.video.id)?.bytes ?? 0), 0);
  const fallbacks = selected.filter((e) => choices.get(e.video.id)?.fallback).length;
  const tooBig = freeBytes !== undefined && bytes + 64 * 1024 ** 2 > freeBytes;
  const kinds = [...new Set(pending.flatMap((e) => e.plan ? textSubtitles(e.plan).map(subtitleKind) : []))].sort((a, b) => subtitleKindLabel(a).localeCompare(subtitleKindLabel(b)));

  const start = async () => {
    setAdding({ done: 0, total: selected.length }); setError(null);
    const bridge = downloadBridge()!;
    const failed: string[] = [];
    // In episode order, so the queue (oldest first) downloads them in order too.
    for (const [index, episode] of selected.entries()) {
      const { bytes: _bytes, fallback: _fallback, ...selection } = choices.get(episode.video.id) as NonNullable<ReturnType<typeof selectionFor>>;
      const subtitles = subtitleKinds.flatMap((kind) => { const track = textSubtitles(episode.plan!).find((s) => subtitleKind(s) === kind); return track ? [captionId(track, backend)] : []; });
      try { await bridge.add({ ...selection, subtitles }); }
      catch (e) { failed.push(`${episode.video.title}: ${(e as Error).message}`); }
      setAdding({ done: index + 1, total: selected.length });
    }
    writePrefs({ subtitles: subtitleKinds, ...(conversions.length ? { audio, conversion: quality } : {}) });
    onClose();
    const added = selected.length - failed.length;
    if (added) toast.success(`${added} ${added === 1 ? "episode" : "episodes"} added to Downloads`, { description: failed.length ? `${failed.length} couldn't be added.` : "They download one after another while you browse.", action: { label: "View", onClick: () => navigate("/downloads") } });
    else toast.error("No episodes were added", { description: failed[0] });
  };

  const allOn = selected.length > 0 && selected.length === available.length;
  return <Dialog open onOpenChange={(value) => !adding && !value && onClose()}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Download {label ?? "season"}</DialogTitle><DialogDescription>{show.name}</DialogDescription></DialogHeader>
      {!ready && !error && <div role="status" className="text-muted-foreground space-y-2 py-4 text-sm">
        <p className="flex items-center gap-2"><Spinner />{episodes ? `Checking episodes… ${planned} of ${episodes.length}` : "Loading episodes…"}</p>
        {episodes && <Progress value={episodes.length ? planned / episodes.length * 100 : 0} className="h-1" aria-hidden />}
      </div>}
      {ready && episodes.length === 0 && <p className="text-muted-foreground py-4 text-sm">This season has no episodes.</p>}
      {ready && episodes.length > 0 && <div className="space-y-5">
        {audioOptions.length > 1 && <div className="space-y-2">
          <Label htmlFor={`${formId}-audio`}>Audio</Label>
          <Select value={audio} disabled={!!adding} onValueChange={setAudio}>
            <SelectTrigger id={`${formId}-audio`} className="w-full"><SelectValue placeholder="Choose audio" /></SelectTrigger>
            <SelectContent>{audioOptions.map((locale) => <SelectItem key={locale} value={locale}>{languageName(locale)}</SelectItem>)}</SelectContent>
          </Select>
          {fallbacks > 0 && <p className="text-muted-foreground text-xs">{fallbacks} {fallbacks === 1 ? "episode doesn't" : "episodes don't"} have {languageName(audio)} audio and will use their default.</p>}
        </div>}
        {qualityOptions.length > 0 && <fieldset>
          <legend className="mb-2 text-sm font-medium">Quality</legend>
          <div role="radiogroup" aria-label="Quality" className="flex flex-wrap gap-2">
            {qualityOptions.map((q) => <button key={q.id} type="button" role="radio" aria-checked={q.id === quality} disabled={!!adding} onClick={() => setQuality(q.id)}
              className={cn("hover:bg-muted rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50", q.id === quality && "border-brand bg-brand/10 hover:bg-brand/10 font-medium")}>{q.label}</button>)}
          </div>
          <p className="text-muted-foreground mt-2 text-xs">{qualityOptions.find((q) => q.id === quality)?.copy ? "Keeps each episode's original video untouched." : "Your Plex server converts the video to H.264 while it downloads, which is slower than Original on servers without hardware transcoding."} Audio is converted to AAC stereo.</p>
        </fieldset>}
        {kinds.length > 0 && <fieldset>
          <legend className="mb-2 text-sm font-medium">Subtitles</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2.5">{kinds.map((kind) => <div key={kind} className="flex items-center gap-2">
            <Checkbox id={`${formId}-sub-${kind}`} disabled={!!adding} checked={subtitleKinds.includes(kind)} onCheckedChange={(on) => setSubtitleKinds((old) => on === true ? [...old, kind] : old.filter((k) => k !== kind))} />
            <Label htmlFor={`${formId}-sub-${kind}`} className="font-normal">{subtitleKindLabel(kind)}</Label>
          </div>)}</div>
          <p className="text-muted-foreground mt-2 text-xs">Saved for each episode that has them.</p>
        </fieldset>}
        <fieldset>
          <div className="mb-2 flex items-center justify-between gap-3">
            <legend className="text-sm font-medium">Episodes</legend>
            {available.length > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!!adding} onClick={() => setChosen(new Set(allOn ? [] : available.map((e) => e.video.id)))}>{allOn ? "Select none" : "Select all"}</Button>}
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">{episodes.map((e, index) => {
            const done = saved.has(e.video.id);
            const id = `${formId}-episode-${index}`;
            const choice = choices.get(e.video.id);
            return <li key={e.video.id} className="flex items-start gap-3 rounded-lg px-1 py-1.5">
              {done ? <CheckCircle2 className="text-brand mt-0.5 size-4 shrink-0" aria-label="Already downloaded" /> : <Checkbox id={id} className="mt-0.5" disabled={!choice || !!adding} checked={chosen.has(e.video.id)} onCheckedChange={(on) => setChosen((old) => { const next = new Set(old); if (on === true) next.add(e.video.id); else next.delete(e.video.id); return next; })} />}
              <Label htmlFor={done ? undefined : id} className="min-w-0 flex-1 flex-col items-start gap-0.5 font-normal">
                <span className="line-clamp-1">{e.video.episode?.number && <span className="text-muted-foreground mr-1.5 tabular-nums">{e.video.episode.number}.</span>}{e.video.title}</span>
                <span className={e.error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>{done ? "Already in Downloads" : e.error ?? (choice ? `~${fileSize(choice.bytes)}${choice.fallback ? " · default audio" : ""}` : "")}</span>
              </Label>
            </li>;
          })}</ul>
        </fieldset>
        <p className={tooBig ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {selected.length} {selected.length === 1 ? "episode" : "episodes"} · about {fileSize(bytes)}{freeBytes !== undefined && ` · ${fileSize(freeBytes)} free on this device`}
          {tooBig && ". Free up some space, choose a lower quality or fewer episodes."}
        </p>
        {adding && <Progress value={adding.done / adding.total * 100} className="h-1" aria-label="Adding episodes" />}
      </div>}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={!!adding} onClick={onClose}>Cancel</Button>
        <Button disabled={!ready || !selected.length || tooBig || !!adding} onClick={() => void start()}>
          {adding ? <><Spinner />Adding {adding.done} of {adding.total}…</> : <><Download className="size-4" />Download {selected.length || ""} {selected.length === 1 ? "episode" : "episodes"}</>}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
