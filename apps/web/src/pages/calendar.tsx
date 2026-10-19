/*
 * When followed channels and shows release, across services: a month grid and a week of
 * days × hours, in the viewer's time zone. Weekly shows also get their expected next episodes
 * (dashed), projected from the last two releases.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { PageHeader, ServicePills } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useVideoTitle } from "@/components/video-card";
import { episodeLabel } from "@/components/service-mark";
import { useData } from "@/hooks/use-data";
import { useTitle } from "@/hooks/use-title";
import { api, qs } from "@/lib/api";
import { channelRef, itemKey, paths } from "@/lib/paths";
import { backendName, useAccounts } from "@/lib/session";
import { useStore } from "@/lib/store";
import type { Video } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAY = 864e5;
const WEEK = 7 * DAY;
type View = "month" | "week";
/**
 * A release on the calendar; `expected` ones are projected, not announced. Episodes of one show
 * released together (a whole season at once) are one entry, `video` being the first of `count`.
 */
type Entry = { video: Video; at: Date; expected?: boolean; count?: number; last?: Video };

/** Merge episodes of the same show released at the same moment. */
function batch(entries: Entry[]): Entry[] {
  const out: Entry[] = [];
  const open = new Map<string, Entry>();
  for (const e of entries) {
    const key = e.video.episode && !e.expected ? `${e.video.backend}:${e.video.channelId}@${e.at.getTime()}` : null;
    const group = key ? open.get(key) : undefined;
    if (group) {
      group.count = (group.count ?? 1) + 1;
      group.last = e.video;
      continue;
    }
    const entry = { ...e };
    if (key) open.set(key, entry);
    out.push(entry);
  }
  return out;
}

/** "S3 E5 · Title", or "S3 E1–24 · 24 episodes" for a batch. */
function describe(entry: Entry, title: string) {
  const { video, count, last } = entry;
  if (!video.episode) return title;
  if (count && last?.episode?.number) return `${episodeLabel(video.episode)}–${last.episode.number} · ${count} episodes`;
  return `${episodeLabel(video.episode)} · ${title}`;
}

// Local-time date helpers (weeks start on Monday).
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const fmt = {
  month: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }),
  short: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
  weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }),
  long: new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }),
  time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }),
  hour: new Intl.DateTimeFormat(undefined, { hour: "numeric" }),
};

/** The days a view shows: whole weeks around the month, or one week. */
function span(view: View, anchor: Date) {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start, end: addDays(startOfWeek(last), 7) };
}

/**
 * Weekly shows: when the last two episodes came about a week apart and the latest is recent,
 * expect the next ones on the same weekday and time (up to four weeks ahead).
 */
function project(videos: Video[], end: Date): Entry[] {
  const byShow = new Map<string, Video[]>();
  for (const v of videos) if (v.episode) byShow.set(`${v.backend}:${v.channelId}`, [...(byShow.get(`${v.backend}:${v.channelId}`) ?? []), v]);
  const now = Date.now();
  const out: Entry[] = [];
  for (const list of byShow.values()) {
    const sorted = list.slice().sort((a, b) => a.published.localeCompare(b.published));
    const [prev, last] = sorted.slice(-2);
    if (!prev || !last) continue;
    const gap = Date.parse(last.published) - Date.parse(prev.published);
    if (Math.abs(gap - WEEK) > DAY || now - Date.parse(last.published) > 2 * WEEK) continue;
    for (let t = Date.parse(last.published) + WEEK; t < end.getTime() && t < now + 4 * WEEK; t += WEEK) {
      if (t > now) out.push({ video: last, at: new Date(t), expected: true });
    }
  }
  return out;
}

export function CalendarPage() {
  useTitle("Calendar");
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [service, setService] = useState("all");
  const { feedBackends } = useAccounts();
  const muted = useStore((s) => s.muted);
  const { start, end } = span(view, anchor);

  // Two weeks before the view too, to see which shows are on a weekly schedule.
  const state = useData(
    () => api<Video[]>(`/calendar${qs({ from: addDays(start, -14).toISOString(), to: end.toISOString(), backend: service === "all" ? undefined : service })}`),
    [start.getTime(), end.getTime(), service],
  );
  // Keep showing the last result while the next range loads.
  const last = useRef<Video[] | null>(null);
  if (state.status === "ready") last.current = state.data;
  const videos = state.status === "ready" ? state.data : last.current;

  const entries = useMemo(() => {
    if (!videos) return null;
    const shown = videos.filter((v) => !muted.includes(itemKey(channelRef(v))));
    return batch(
      [...shown.map((v): Entry => ({ video: v, at: new Date(v.published) })), ...project(shown, end)]
        .filter((e) => e.at >= start && e.at < end)
        .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.video.episode?.number ?? "").localeCompare(b.video.episode?.number ?? "", undefined, { numeric: true })),
    );
  }, [videos, muted, start.getTime(), end.getTime()]);
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries ?? []) map.set(dayKey(e.at), [...(map.get(dayKey(e.at)) ?? []), e]);
    return map;
  }, [entries]);

  const move = (step: number) => {
    const next = view === "week" ? addDays(anchor, 7 * step) : new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
    setAnchor(next);
    setSelected(view === "week" ? addDays(selected, 7 * step) : next);
  };
  const today = () => {
    setAnchor(startOfDay(new Date()));
    setSelected(startOfDay(new Date()));
  };
  const title = view === "month" ? fmt.month.format(anchor) : `${fmt.short.format(start)} – ${fmt.short.format(addDays(end, -1))}, ${addDays(end, -1).getFullYear()}`;

  return (
    <div className="page">
      <PageHeader title="Calendar" description="When the channels and shows you follow release, across every service." />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <ServicePills label="View" value={view} onChange={(v) => setView(v as View)} options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }]} />
        {feedBackends.length > 1 && (
          <ServicePills
            label="Service"
            value={service}
            onChange={setService}
            options={[{ value: "all", label: "Everything" }, ...feedBackends.map((b) => ({ value: b.slug, label: backendName(b), color: b.info?.color }))]}
          />
        )}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <h2 className="font-display mr-auto text-xl font-semibold sm:text-2xl">{title}</h2>
        <Button variant="outline" size="sm" className="rounded-full" onClick={today}>
          Today
        </Button>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={view === "week" ? "Previous week" : "Previous month"} onClick={() => move(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={view === "week" ? "Next week" : "Next month"} onClick={() => move(1)}>
          <ChevronRight />
        </Button>
      </div>

      {state.status === "error" && <p className="text-destructive mt-6 text-sm">{state.error.message}</p>}
      {!entries && state.status === "loading" && <Skeleton className="mt-4 h-[32rem] rounded-2xl" />}
      {entries && (
        <div className={cn("mt-4 transition-opacity", state.status === "loading" && "opacity-60")}>
          {view === "month" ? (
            <MonthGrid anchor={anchor} start={start} end={end} byDay={byDay} selected={selected} onSelect={setSelected} />
          ) : (
            <WeekGrid start={start} entries={entries} />
          )}
          {view === "month" && <DayList day={selected} entries={byDay.get(dayKey(selected)) ?? []} />}
          {entries.length === 0 && state.status === "ready" && (
            <Empty className="mt-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarDays />
                </EmptyMedia>
                <EmptyTitle>Nothing released {view === "week" ? "this week" : "this month"}</EmptyTitle>
                <EmptyDescription>Uploads from channels you subscribe to and episodes of shows on your watchlist show up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <p className="text-muted-foreground mt-6 flex gap-2 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Times are in your time zone. Dashed entries are expected episodes of weekly shows. YouTube lists each channel's latest 15 uploads, so weeks further
            back only show channels that upload less often.
          </p>
        </div>
      )}
    </div>
  );
}

function MonthGrid({
  anchor,
  start,
  end,
  byDay,
  selected,
  onSelect,
}: {
  anchor: Date;
  start: Date;
  end: Date;
  byDay: Map<string, Entry[]>;
  selected: Date;
  onSelect: (day: Date) => void;
}) {
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  const todayKey = dayKey(new Date());
  return (
    <div className="overflow-hidden rounded-2xl border">
      <div className="bg-card grid grid-cols-7 border-b">
        {days.slice(0, 7).map((d) => (
          <div key={d.getDay()} className="text-muted-foreground px-2 py-2 text-center text-xs font-medium sm:text-left">
            {fmt.weekday.format(d)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const list = byDay.get(dayKey(d)) ?? [];
          const isToday = dayKey(d) === todayKey;
          const isSelected = dayKey(d) === dayKey(selected);
          return (
            <button
              key={dayKey(d)}
              type="button"
              onClick={() => onSelect(d)}
              aria-pressed={isSelected}
              aria-label={`${fmt.long.format(d)}: ${list.length} ${list.length === 1 ? "release" : "releases"}`}
              className={cn(
                "hover:bg-muted/50 flex min-h-16 min-w-0 flex-col gap-1 border-b p-1 text-left transition-colors sm:min-h-32 sm:p-1.5",
                i % 7 !== 6 && "border-r",
                i >= days.length - 7 && "border-b-0",
                !sameMonth(d, anchor) && "text-muted-foreground/60",
                isSelected && "bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs font-medium tabular-nums",
                  isToday && "bg-brand text-brand-foreground",
                )}
              >
                {d.getDate()}
              </span>
              {/* Phones: a dot per service. Wider: the first releases, then a count. */}
              <span className="flex flex-wrap gap-0.5 sm:hidden">
                {list.slice(0, 6).map((e, j) => (
                  <Dot key={j} entry={e} />
                ))}
              </span>
              <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {/* Shows first: they're what a calendar is most often checked for. */}
                {[...list.filter((e) => e.video.episode), ...list.filter((e) => !e.video.episode)].slice(0, 3).map((e, j) => (
                  <MonthChip key={j} entry={e} />
                ))}
                {list.length > 3 && <span className="text-muted-foreground px-1 text-[11px]">+{list.length - 3} more</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function useColor(backend?: string) {
  const { bySlug } = useAccounts();
  return bySlug(backend)?.info?.color ?? "var(--muted-foreground)";
}

function Dot({ entry }: { entry: Entry }) {
  const color = useColor(entry.video.backend);
  return <span className={cn("size-1.5 rounded-full", entry.expected && "opacity-50")} style={{ background: color }} />;
}

function MonthChip({ entry }: { entry: Entry }) {
  const color = useColor(entry.video.backend);
  const name = entry.video.episode?.seriesTitle || entry.video.channelName;
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight", entry.expected ? "border border-dashed" : "bg-muted/70")}
      style={entry.expected ? { borderColor: color } : { boxShadow: `inset 2px 0 0 ${color}` }}
    >
      <span className="text-muted-foreground shrink-0 tabular-nums">{fmt.time.format(entry.at)}</span>
      <span className="truncate">{name}</span>
      {entry.count && <span className="text-muted-foreground shrink-0">×{entry.count}</span>}
    </span>
  );
}

/** Every release on one day (under the month grid). */
function DayList({ day, entries }: { day: Date; entries: Entry[] }) {
  return (
    <section className="mt-6" aria-label={fmt.long.format(day)}>
      <h3 className="mb-3 text-sm font-semibold">
        {fmt.long.format(day)} <span className="text-muted-foreground font-normal">· {entries.length} {entries.length === 1 ? "release" : "releases"}</span>
      </h3>
      {entries.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((e, i) => (
            <Release key={i} entry={e} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A release as a small card: time, thumbnail, title, channel or show. */
function Release({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const { video, at, expected } = entry;
  const color = useColor(video.backend);
  const title = useVideoTitle(video);
  const name = video.episode?.seriesTitle || video.channelName;
  const label = expected ? "Expected next episode" : describe(entry, title);
  const body = (
    <>
      {!compact && (
        <span className="bg-muted relative aspect-video w-24 shrink-0 overflow-hidden rounded-md">
          {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" className={cn("size-full object-cover", expected && "opacity-40 grayscale")} />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tabular-nums">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {fmt.time.format(at)}
          {video.upcoming && !expected && " · Premiere"}
          {video.live && " · Live"}
        </span>
        <span className={cn("block truncate font-medium", compact ? "text-xs" : "text-sm")}>{name}</span>
        <span className={cn("text-muted-foreground block", compact ? "line-clamp-2 text-[11px]" : "truncate text-xs")}>{label}</span>
      </span>
    </>
  );
  const className = cn(
    "hover:bg-muted/60 flex min-w-0 items-start gap-2.5 rounded-lg p-1.5 transition-colors",
    compact && "bg-card border",
    expected && "border border-dashed",
  );
  // An expected episode isn't out yet: open the show instead.
  return expected ? (
    <Link to={paths.channel(channelRef(video))} className={className} style={{ borderColor: color }}>
      {body}
    </Link>
  ) : (
    <Link to={paths.watch(video)} className={className} style={compact ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}>
      {body}
    </Link>
  );
}

/** One week: a column per day, a row per hour (hours with nothing in them stay short). */
function WeekGrid({ start, entries }: { start: Date; entries: Entry[] }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const cells = new Map<string, Entry[]>();
  for (const e of entries) cells.set(`${dayKey(e.at)}@${e.at.getHours()}`, [...(cells.get(`${dayKey(e.at)}@${e.at.getHours()}`) ?? []), e]);
  const todayKey = dayKey(new Date());
  const scroller = useRef<HTMLDivElement>(null);
  const firstHour = entries.length ? Math.min(...entries.map((e) => e.at.getHours())) : 8;
  // Start at the first busy hour.
  useEffect(() => {
    const row = scroller.current?.querySelector<HTMLElement>(`[data-hour="${firstHour}"]`);
    const header = scroller.current?.querySelector<HTMLElement>("[data-week-header]");
    if (scroller.current && row && header) scroller.current.scrollTop = row.offsetTop - header.offsetHeight;
  }, [start.getTime(), firstHour]);
  const now = new Date();
  return (
    <div ref={scroller} data-week-scroller className="relative max-h-[70vh] overflow-auto rounded-2xl border [--week-header-height:4rem]">
      <div className="min-w-[56rem]">
        <div data-week-header className="bg-card sticky top-0 z-20 grid h-[var(--week-header-height)] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
          <div className="bg-card sticky left-0 z-30" />
          {days.map((d) => {
            const count = entries.filter((e) => dayKey(e.at) === dayKey(d)).length;
            return (
              <div key={dayKey(d)} className="border-l px-2 py-2">
                <div className="text-muted-foreground text-xs">{fmt.weekday.format(d)}</div>
                <div className="flex items-baseline gap-1.5">
                  <span className={cn("text-lg font-semibold tabular-nums", dayKey(d) === todayKey && "text-brand")}>{d.getDate()}</span>
                  {count > 0 && <span className="text-muted-foreground text-[11px]">{count}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} data-hour={hour} className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b last:border-b-0">
            <div className="bg-background text-muted-foreground sticky left-0 z-10 text-right text-[11px] tabular-nums">
              {/* Confined to this hour's row: the next hour pushes this label out. */}
              <span data-hour-label className="sticky top-[var(--week-header-height)] block px-2 pt-1">
                {fmt.hour.format(new Date(2000, 0, 1, hour))}
              </span>
            </div>
            {days.map((d) => {
              const list = cells.get(`${dayKey(d)}@${hour}`) ?? [];
              const current = dayKey(d) === todayKey && now.getHours() === hour;
              return (
                <div key={dayKey(d)} className={cn("relative flex min-h-10 min-w-0 flex-col gap-1 border-l p-1", dayKey(d) === todayKey && "bg-muted/25")}>
                  {current && (
                    <span aria-hidden className="bg-brand absolute inset-x-0 z-[1] h-px" style={{ top: `${(now.getMinutes() / 60) * 100}%` }} />
                  )}
                  {list.map((e, i) => (
                    <Release key={i} entry={e} compact />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
