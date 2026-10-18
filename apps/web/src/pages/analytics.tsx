import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChartColumn, Clock, FastForward, Flame, Lock, Repeat, Scissors, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import type { WatchStats } from "@tube/shared";
import { PageHeader, ServicePills } from "@/components/page-header";
import { ServiceMark } from "@/components/service-mark";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/hooks/use-data";
import { useTitle } from "@/hooks/use-title";
import { api } from "@/lib/api";
import { formatAgo, formatWatchTime } from "@/lib/format";
import { backendName, useAccounts } from "@/lib/session";
import { actions, useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

const ranges = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "Year" },
  { value: "0", label: "All time" },
];

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" });
const shortDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));
const longDay = (day: string) => `${weekdayFormat.format(new Date(`${day}T00:00:00Z`))}, ${shortDay(day)}`;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const hourLabel = (hour: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, hour));
// Monday first; the server counts 0 = Sunday.
const weekOrder = [1, 2, 3, 4, 5, 6, 0];
const weekdayShort = (d: number) => new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2000, 0, 2 + d));

export function AnalyticsPage() {
  useTitle("Analytics");
  const [days, setDays] = useState("30");
  const { keepHistory } = useSettings();
  const state = useData(() => api<WatchStats>(`/me/stats?days=${days}&tz=${encodeURIComponent(tz)}`), [days]);
  const stats = state.data;
  const empty = stats && !stats.totals.seconds && !stats.since;

  return (
    <div className="page">
      <PageHeader
        title="Analytics"
        icon={Lock}
        description="What you've actually watched: time played, not just opened. Kept in your Fanoos account, never sent to the services."
      />
      <ServicePills className="mt-6" label="Period" value={days} onChange={setDays} options={ranges} />

      {!keepHistory && (
        <p className="bg-card text-muted-foreground mt-6 max-w-3xl rounded-2xl border p-4 text-sm">
          Watch history is paused, so nothing new is counted.{" "}
          <button type="button" className="text-foreground font-medium underline-offset-4 hover:underline" onClick={() => actions.setting("keepHistory", true)}>
            Turn it back on
          </button>
        </p>
      )}

      {state.status === "loading" && <StatsSkeleton />}
      {state.status === "error" && <p className="text-destructive mt-8 text-sm">{state.error.message}</p>}
      {empty && (
        <Empty className="mt-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumn />
            </EmptyMedia>
            <EmptyTitle>Nothing counted yet</EmptyTitle>
            <EmptyDescription>Play something; this page fills in as you watch.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {stats && !empty && <Report stats={stats} />}
    </div>
  );
}

function Report({ stats }: { stats: WatchStats }) {
  const { totals, previous } = stats;
  const periodDays = stats.daily.length || 1;
  const label = stats.days ? `previous ${stats.days} days` : "";
  return (
    <div className="mt-8 space-y-10">
      <Recap stats={stats} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Figure
          label="Time watched"
          value={formatWatchTime(totals.seconds)}
          detail={<Change now={totals.seconds} before={previous?.seconds} against={label} />}
        />
        <Figure
          label="Daily average"
          value={formatWatchTime(totals.seconds / periodDays)}
          detail={totals.activeDays ? `${formatWatchTime(totals.seconds / totals.activeDays)} on the ${totals.activeDays} ${totals.activeDays === 1 ? "day" : "days"} you watched` : "No days watched"}
        />
        <Figure
          label="Videos and episodes"
          value={totals.items.toLocaleString()}
          detail={`${totals.finished.toLocaleString()} finished · ${totals.channels} ${totals.channels === 1 ? "channel or show" : "channels and shows"}`}
        />
        <Figure
          label="Streak"
          value={`${stats.streak.current} ${stats.streak.current === 1 ? "day" : "days"}`}
          detail={`Longest: ${stats.streak.longest} ${stats.streak.longest === 1 ? "day" : "days"}`}
          icon={stats.streak.current >= 3 ? Flame : undefined}
        />
      </div>

      <Section title="Day by day" aside={stats.since ? `Counting since ${formatAgo(new Date(stats.since).toISOString())}` : undefined}>
        <DailyChart stats={stats} />
      </Section>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Channels and shows" aside="By time watched">
          <Channels stats={stats} />
        </Section>
        <div className="space-y-10">
          <Section title="When you watch">
            <Heatmap stats={stats} />
          </Section>
          <Section title="Services">
            <Services stats={stats} />
          </Section>
        </div>
      </div>

      <Highlights stats={stats} />

      {stats.items.length > 0 && (
        <Section title="Most watched">
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            {stats.items.map((item, i) => (
              <Link key={item.key} to={`/watch/${item.backend}/${item.id}`} className="group/item hover:bg-muted/60 -m-2 flex items-center gap-4 rounded-xl p-2">
                <span className="text-muted-foreground w-5 text-right text-sm tabular-nums">{i + 1}</span>
                <div className="bg-muted aspect-video w-32 shrink-0 overflow-hidden rounded-lg">
                  {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" className="size-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug font-medium">{item.title}</p>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {item.channelName} · {formatWatchTime(item.seconds)}
                    {item.plays >= 1.5 ? ` · watched ${item.plays.toFixed(1)}×` : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Peak weekday (0 = Sunday) and hour of day, from the heatmap. */
function peaks(stats: WatchStats) {
  const byHour = Array.from({ length: 24 }, (_, h) => stats.heatmap.reduce((n, row) => n + row[h]!, 0));
  const byDay = stats.heatmap.map((row) => row.reduce((a, b) => a + b, 0));
  return { hour: byHour.indexOf(Math.max(...byHour)), day: byDay.indexOf(Math.max(...byDay)) };
}

const periodName = (days: number) =>
  days === 0 ? "All time" : days === 365 ? "Your year" : days === 7 ? "Your week" : `Your last ${days} days`;

/** The period at a glance, like a year-end recap: the headline number and what defined it. */
function Recap({ stats }: { stats: WatchStats }) {
  const top = stats.channels[0];
  const { hour, day } = peaks(stats);
  const hours = stats.totals.seconds / 3600;
  // A sense of scale for the headline number.
  const perDay = stats.totals.seconds / (stats.daily.length || 1);
  const scale =
    hours >= 48
      ? `That's ${(hours / 24).toFixed(1)} days, back to back.`
      : perDay >= 60
        ? `About ${formatWatchTime(perDay)} a day.`
        : "";
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border bg-neutral-950 text-white">
      {top?.thumbnail && <img src={top.thumbnail} alt="" className="absolute inset-0 -z-10 size-full scale-110 object-cover opacity-40 blur-2xl" />}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklch,var(--brand)_55%,transparent),transparent_60%)]" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-end">
        <div>
          <p className="text-sm font-medium tracking-wide text-white/70 uppercase">{periodName(stats.days)}</p>
          <p className="font-display mt-3 text-6xl leading-none font-semibold tabular-nums sm:text-8xl">{formatWatchTime(stats.totals.seconds)}</p>
          <p className="mt-3 text-lg text-white/85">of watching. {scale}</p>
          <div className="mt-8 flex flex-wrap gap-2 text-sm">
            <Chip>
              {stats.totals.items.toLocaleString()} {stats.totals.items === 1 ? "video or episode" : "videos and episodes"}
            </Chip>
            {stats.totals.seconds > 0 && (
              <Chip>
                Mostly {weekdayFormat.format(Date.UTC(2000, 0, 2 + day))}s around {hourLabel(hour)}
              </Chip>
            )}
            {stats.streak.longest >= 2 && <Chip>Longest streak: {stats.streak.longest} days</Chip>}
            {stats.backends.length > 1 && <Chip>{stats.backends.length} services</Chip>}
          </div>
        </div>
        {top && (
          <Link to={`/channel/${top.backend}/${top.id}`} className="group/top block rounded-2xl bg-white/10 p-3 backdrop-blur-md transition-colors hover:bg-white/15">
            <p className="px-1 pb-3 text-xs font-medium tracking-wide text-white/70 uppercase">Your top {top.kind === "episode" ? "show" : "channel"}</p>
            <div className="aspect-video overflow-hidden rounded-xl bg-white/10">
              {top.thumbnail && <img src={top.thumbnail} alt="" className="size-full object-cover transition-transform duration-500 group-hover/top:scale-[1.03]" />}
            </div>
            <p className="font-display mt-3 truncate px-1 text-xl font-semibold">{top.name}</p>
            <p className="px-1 pb-1 text-sm text-white/70">
              {formatWatchTime(top.seconds)} · {percent(top.seconds / (stats.totals.seconds || 1))} of your time
            </p>
          </Link>
        )}
      </div>
    </section>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-white/12 px-3 py-1.5 font-medium backdrop-blur">{children}</span>;
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {aside && <p className="text-muted-foreground text-xs">{aside}</p>}
      </div>
      {children}
    </section>
  );
}

function Figure({ label, value, detail, icon: Icon }: { label: string; value: string; detail?: ReactNode; icon?: typeof Flame }) {
  return (
    <div className="bg-card rounded-2xl border p-4 sm:p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="font-display mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums sm:text-3xl">
        {value}
        {Icon && <Icon className="size-6 text-orange-500" />}
      </p>
      {detail && <div className="text-muted-foreground mt-2 text-xs">{detail}</div>}
    </div>
  );
}

function Change({ now, before, against }: { now: number; before?: number; against: string }) {
  if (before === undefined) return null;
  if (!before) return <span>Nothing in the {against}</span>;
  const change = (now - before) / before;
  if (Math.abs(change) < 0.05) return <span>About the same as the {against}</span>;
  const Icon = change > 0 ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5" />
      {percent(Math.abs(change))} {change > 0 ? "more" : "less"} than the {against}
    </span>
  );
}

function useColor() {
  const { bySlug } = useAccounts();
  return (backend: string) => bySlug(backend)?.info?.color ?? "var(--brand)";
}

function DailyChart({ stats }: { stats: WatchStats }) {
  const color = useColor();
  const { bySlug } = useAccounts();
  // Long periods are grouped into weeks, then months, so bars stay readable.
  const size = stats.daily.length <= 92 ? 1 : stats.daily.length <= 730 ? 7 : 30;
  const buckets: { day: string; end: string; seconds: number; byBackend: Record<string, number> }[] = [];
  for (let i = 0; i < stats.daily.length; i += size) {
    const chunk = stats.daily.slice(i, i + size);
    const byBackend: Record<string, number> = {};
    for (const d of chunk) for (const [b, s] of Object.entries(d.byBackend)) byBackend[b] = (byBackend[b] ?? 0) + s;
    buckets.push({ day: chunk[0]!.day, end: chunk.at(-1)!.day, seconds: chunk.reduce((n, d) => n + d.seconds, 0), byBackend });
  }
  const max = Math.max(...buckets.map((b) => b.seconds), 60);
  const backends = stats.backends.map((b) => b.backend);
  const unit = size === 1 ? "a day" : size === 7 ? "a week" : "a month";
  return (
    <div className="bg-card rounded-2xl border p-5">
      <div className="text-muted-foreground mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>Most in {unit}: {formatWatchTime(max)}</span>
        <span className="ml-auto flex flex-wrap gap-3">
          {backends.map((b) => (
            <span key={b} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: color(b) }} />
              {backendName(bySlug(b))}
            </span>
          ))}
        </span>
      </div>
      <div className="flex h-44 items-end gap-[2px]" role="img" aria-label={`Time watched per ${unit.slice(2)}`}>
        {buckets.map((b) => (
          <div
            key={b.day}
            title={`${size === 1 ? longDay(b.day) : `${shortDay(b.day)} – ${shortDay(b.end)}`}: ${formatWatchTime(b.seconds)}`}
            className="group/bar flex h-full min-w-0 flex-1 flex-col-reverse rounded-t-[3px] hover:opacity-80"
          >
            {b.seconds === 0 ? (
              <div className="bg-muted h-[2px] rounded-full" />
            ) : (
              backends.map((backend) =>
                b.byBackend[backend] ? (
                  <div key={backend} style={{ height: `${(b.byBackend[backend]! / max) * 100}%`, background: color(backend) }} className="first:rounded-b-[1px] last:rounded-t-[3px]" />
                ) : null,
              )
            )}
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-2 flex justify-between text-[11px] tabular-nums">
        <span>{shortDay(stats.from)}</span>
        {buckets.length > 6 && <span>{shortDay(buckets[Math.floor(buckets.length / 2)]!.day)}</span>}
        <span>{shortDay(stats.to)}</span>
      </div>
    </div>
  );
}

function Channels({ stats }: { stats: WatchStats }) {
  if (!stats.channels.length) return <p className="text-muted-foreground text-sm">Nothing watched for long enough in this period.</p>;
  const max = stats.channels[0]!.seconds;
  return (
    <div className="bg-card divide-y rounded-2xl border">
      {stats.channels.slice(0, 12).map((ch) => (
        <Link key={ch.key} to={`/channel/${ch.backend}/${ch.id}`} className="hover:bg-muted/50 flex items-center gap-4 p-3 first:rounded-t-2xl last:rounded-b-2xl sm:px-4">
          <div className="bg-muted aspect-video w-20 shrink-0 overflow-hidden rounded-md">
            {ch.thumbnail && <img src={ch.thumbnail} alt="" loading="lazy" className="size-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              <ServiceMark backend={ch.backend} />
              <span className="truncate">{ch.name}</span>
            </p>
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <div className="bg-brand h-full rounded-full" style={{ width: `${Math.max((ch.seconds / max) * 100, 2)}%` }} />
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs">
              {ch.items} {ch.kind === "episode" ? (ch.items === 1 ? "episode" : "episodes") : ch.items === 1 ? "video" : "videos"} · {formatWatchTime(ch.seconds / ch.items)} each on average · {percent(ch.completion)} watched through
            </p>
          </div>
          <p className="font-display shrink-0 text-right text-lg font-semibold tabular-nums">{formatWatchTime(ch.seconds)}</p>
        </Link>
      ))}
    </div>
  );
}

function Heatmap({ stats }: { stats: WatchStats }) {
  const max = Math.max(...stats.heatmap.flat(), 1);
  const { hour: peakHour, day: peakDay } = peaks(stats);
  return (
    <div className="bg-card rounded-2xl border p-5">
      <p className="text-sm">
        Mostly <span className="font-semibold">{weekdayFormat.format(Date.UTC(2000, 0, 2 + peakDay))}s</span>, around{" "}
        <span className="font-semibold">{hourLabel(peakHour)}</span>.
      </p>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-2 gap-y-[3px]">
        {weekOrder.map((d) => (
          <div key={d} className="contents">
            <span className="text-muted-foreground pr-1 text-[11px] leading-3">{weekdayShort(d)}</span>
            <div className="grid grid-cols-24 gap-[3px]">
              {stats.heatmap[d]!.map((seconds, h) => (
                <div
                  key={h}
                  title={`${weekdayShort(d)} ${hourLabel(h)}: ${formatWatchTime(seconds)}`}
                  className="bg-muted aspect-square rounded-[3px]"
                  style={seconds ? { background: `color-mix(in oklch, var(--brand) ${Math.round(15 + (seconds / max) * 85)}%, transparent)` } : undefined}
                />
              ))}
            </div>
          </div>
        ))}
        <span />
        <div className="text-muted-foreground mt-1 grid grid-cols-4 text-[10px]">
          {[0, 6, 12, 18].map((h) => (
            <span key={h}>{hourLabel(h)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Services({ stats }: { stats: WatchStats }) {
  const color = useColor();
  const { bySlug } = useAccounts();
  const total = stats.totals.seconds || 1;
  return (
    <div className="bg-card rounded-2xl border p-5">
      <div className="flex h-3 overflow-hidden rounded-full">
        {stats.backends.map((b) => (
          <div key={b.backend} style={{ width: `${(b.seconds / total) * 100}%`, background: color(b.backend) }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {stats.backends.map((b) => (
          <li key={b.backend} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: color(b.backend) }} />
            <span className="font-medium">{backendName(bySlug(b.backend))}</span>
            <span className="text-muted-foreground">
              {b.items} {b.items === 1 ? "item" : "items"}
            </span>
            <span className="ml-auto tabular-nums">
              {formatWatchTime(b.seconds)} <span className="text-muted-foreground">· {percent(b.seconds / total)}</span>
            </span>
          </li>
        ))}
      </ul>
      {stats.categories.length > 0 && (
        <>
          <p className="text-muted-foreground mt-5 mb-2 text-xs">YouTube categories</p>
          <div className="flex flex-wrap gap-1.5">
            {stats.categories.map((c) => (
              <span key={c.name} className="bg-secondary rounded-full px-2.5 py-1 text-xs">
                {c.name} <span className="text-muted-foreground tabular-nums">{formatWatchTime(c.seconds)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Highlights({ stats }: { stats: WatchStats }) {
  const { totals } = stats;
  const saved = totals.media - totals.seconds;
  const cards: { icon: typeof Trophy; label: string; value: string; detail: string }[] = [];
  if (stats.topDay?.seconds) cards.push({ icon: Trophy, label: "Biggest day", value: formatWatchTime(stats.topDay.seconds), detail: longDay(stats.topDay.day) });
  if (stats.binge) cards.push({ icon: Repeat, label: "Longest binge", value: `${stats.binge.episodes} episodes`, detail: `${stats.binge.name}, ${shortDay(stats.binge.day)}` });
  if (totals.skipped >= 30) cards.push({ icon: Scissors, label: "Skipped automatically", value: formatWatchTime(totals.skipped), detail: "Sponsors, intros and more" });
  if (saved >= 60) cards.push({ icon: FastForward, label: "Saved by playback speed", value: formatWatchTime(saved), detail: `${formatWatchTime(totals.media)} of video in ${formatWatchTime(totals.seconds)}` });
  if (totals.items)
    cards.push({
      icon: Clock,
      label: "Average sitting per item",
      value: formatWatchTime(totals.seconds / totals.items),
      detail: totals.finished ? `${percent(totals.finished / totals.items)} played to the end` : "Nothing played to the end yet",
    });
  if (!cards.length) return null;
  return (
    <Section title="Highlights">
      <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-3 xl:grid-cols-5" }[cards.length])}>
        {cards.map(({ icon: Icon, label, value, detail }) => (
          <div key={label} className="bg-card rounded-2xl border p-5">
            <Icon className="text-brand size-5" />
            <p className="text-muted-foreground mt-3 text-sm">{label}</p>
            <p className="font-display mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-muted-foreground mt-1 truncate text-xs">{detail}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function StatsSkeleton() {
  return (
    <div className="mt-8 space-y-10">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <div className="grid gap-10 xl:grid-cols-[3fr_2fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}
