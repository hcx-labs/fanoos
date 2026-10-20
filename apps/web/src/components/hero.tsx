import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, CircleCheck, Clock3, Play } from "lucide-react";
import { ChannelAvatar } from "@/components/channel-avatar";
import { useVideoTitle } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { formatAgo, formatDuration, formatViews } from "@/lib/format";
import { itemKey, paths } from "@/lib/paths";
import { episodeLabel } from "@/components/service-mark";
import { actions, useStore } from "@/lib/store";
import type { Video } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROTATE_MS = 7000;

/** Newest uploads, at most one per channel, so one busy channel can't fill the hero. */
export function pickHeroVideos(videos: Video[], count = 5) {
  const seen = new Set<string>();
  const picks: Video[] = [];
  for (const video of videos) {
    const source = `${video.backend}:${video.channelId}`;
    if (seen.has(source) || video.upcoming) continue;
    seen.add(source);
    picks.push(video);
    if (picks.length === count) break;
  }
  return picks;
}

/** Description without links, hashtags and repeated whitespace, cut to a teaser. */
function teaser(description: string, max = 180) {
  const text = description
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(^|\s)#\w+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rotating spotlight of the latest titles across connected services. */
export function Hero({ videos }: { videos: Video[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still] = useState(prefersReducedMotion);
  const section = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let intersecting = false;
    const sync = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry!.isIntersecting;
      sync();
    });
    if (section.current) observer.observe(section.current);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [videos.length]);
  const count = videos.length;
  const go = (i: number) => setIndex(((i % count) + count) % count);

  useEffect(() => {
    if (paused || still || !visible || count < 2) return;
    const timer = window.setTimeout(() => go(index + 1), ROTATE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, still, visible, count]);

  if (!count) return null;
  const video = videos[Math.min(index, count - 1)]!;

  return (
    <section
      ref={section}
      aria-roledescription="carousel"
      aria-label="Latest across your services"
      className="group/hero bg-card relative mt-8 overflow-hidden rounded-3xl border"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        if (e.key === "ArrowLeft") go(index - 1);
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_19rem]">
        {/* Stage: crossfading full-bleed artwork with the info panel on top. A fixed height
            on phones: an aspect ratio plus a minimum height would widen it past the screen. */}
        <div className="relative isolate h-[27rem] overflow-hidden sm:h-auto sm:aspect-[16/8] lg:aspect-auto lg:min-h-[28rem]">
          {videos.map((v, i) => (
            <img
              key={v.id}
              src={v.thumbnail}
              alt=""
              aria-hidden
              referrerPolicy="no-referrer"
              loading={i === 0 ? "eager" : "lazy"}
              className={cn(
                "absolute inset-0 -z-20 size-full object-cover transition-[opacity,scale] duration-1000 ease-out-quint",
                i === index ? "scale-100 opacity-100" : "scale-105 opacity-0",
              )}
            />
          ))}
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/45 to-black/5" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/70 via-black/20 to-transparent" />

          <div key={itemKey(video)} className="animate-in fade-in slide-in-from-bottom-3 absolute inset-x-0 bottom-0 p-5 text-white duration-700 sm:p-8 lg:p-10">
            <div className="flex items-center gap-2.5 text-sm">
              {video.kind !== "movie" && <ChannelAvatar name={video.channelName} src={video.channelAvatar} className="size-8 ring-2 ring-white/20" textClassName="text-[11px]" />}
              <Link to={paths.channelOf(video)} className="font-semibold hover:underline">
                {video.kind === "movie" ? "Movie" : video.channelName}
              </Link>
              {formatAgo(video.published) && (
                <>
                  <span className="text-white/40">·</span>
                  <span className="text-white/75">{formatAgo(video.published)}</span>
                </>
              )}
            </div>
            <HeroTitle video={video} />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium">
              {video.duration > 0 && <span className="rounded-md bg-white/15 px-2 py-1 tabular-nums backdrop-blur">{formatDuration(video.duration)}</span>}
              {video.episode ? (
                episodeLabel(video.episode) && <span className="rounded-md bg-white/15 px-2 py-1 backdrop-blur">{episodeLabel(video.episode)}</span>
              ) : (
                video.views > 0 && <span className="rounded-md bg-white/15 px-2 py-1 backdrop-blur">{formatViews(video)}</span>
              )}
              {video.live && <span className="rounded-md bg-red-600 px-2 py-1 uppercase">Live</span>}
            </div>
            {teaser(video.description) && <p className="mt-3 line-clamp-2 max-w-xl text-sm text-white/80">{teaser(video.description)}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button asChild size="lg" className="rounded-full bg-white px-5 text-black hover:bg-white/90">
                <Link to={paths.watch(video)}>
                  <Play className="fill-current" /> Watch now
                </Link>
              </Button>
              <SaveButton video={video} />
            </div>
          </div>

          {count > 1 && (
            <div className="absolute top-4 right-4 flex gap-1.5 opacity-0 transition-opacity group-focus-within/hero:opacity-100 group-hover/hero:opacity-100">
              <button type="button" aria-label="Previous" onClick={() => go(index - 1)} className="grid size-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70">
                <ChevronLeft className="size-5" />
              </button>
              <button type="button" aria-label="Next" onClick={() => go(index + 1)} className="grid size-9 place-items-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70">
                <ChevronRight className="size-5" />
              </button>
            </div>
          )}

          {/* Dots on small screens. */}
          {count > 1 && (
            <div className="absolute top-4 left-1/2 flex -translate-x-1/2 gap-1.5 lg:hidden">
              {videos.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  aria-label={`Show ${i + 1} of ${count}`}
                  aria-current={i === index}
                  onClick={() => go(i)}
                  className={cn("h-1.5 rounded-full bg-white/50 transition-all", i === index ? "w-6 bg-white" : "w-1.5")}
                />
              ))}
            </div>
          )}
        </div>

        {/* Queue on wide screens, with a progress bar for the current slide. */}
        {count > 1 && (
          <ol className="hidden flex-col gap-1 border-l p-3 lg:flex">
            <li className="text-muted-foreground px-2 pt-1 pb-2 text-xs font-medium">Latest across your services</li>
            {videos.map((v, i) => (
              <li key={v.id}>
                <QueueItem
                  video={v}
                  active={i === index}
                  running={i === index && !paused && !still && visible}
                  onSelect={() => go(i)}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function HeroTitle({ video }: { video: Video }) {
  const title = useVideoTitle(video);
  return (
    <h2 className="font-display mt-3 max-w-3xl text-2xl leading-tight font-semibold text-balance drop-shadow-sm sm:text-4xl">
      <Link to={video.kind === "movie" ? paths.channelOf(video) : paths.watch(video)} className="hover:underline hover:decoration-white/40 hover:underline-offset-4">
        {title}
      </Link>
    </h2>
  );
}

function SaveButton({ video }: { video: Video }) {
  const later = useStore((s) => s.watchLater.includes(itemKey(video)));
  return (
    <Button
      size="lg"
      variant="outline"
      aria-pressed={later}
      onClick={() => actions.toggleWatchLater(itemKey(video))}
      className="rounded-full border-white/30 bg-white/10 px-5 text-white backdrop-blur hover:bg-white/20 hover:text-white dark:border-white/30 dark:bg-white/10 dark:hover:bg-white/20"
    >
      {later ? <CircleCheck /> : <Clock3 />} {later ? "Saved" : "Watch later"}
    </Button>
  );
}

function QueueItem({ video, active, running, onSelect }: { video: Video; active: boolean; running: boolean; onSelect: () => void }) {
  const title = useVideoTitle(video);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={cn("hover:bg-muted relative flex w-full gap-3 overflow-hidden rounded-xl p-2 text-left transition-colors", active && "bg-muted")}
    >
      <img src={video.thumbnail} alt="" referrerPolicy="no-referrer" className="aspect-video w-24 shrink-0 rounded-lg object-cover" />
      <span className="min-w-0">
        <span className={cn("line-clamp-2 text-[13px] leading-snug font-medium", !active && "text-muted-foreground")}>{title}</span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">{video.channelName}</span>
      </span>
      {active && (
        <span className="bg-border absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full">
          <span
            key={`${itemKey(video)}-${running}`}
            className="bg-brand block h-full origin-left"
            style={{
              animation: running ? `hero-progress ${ROTATE_MS}ms linear forwards` : undefined,
              transform: running ? undefined : "scaleX(0)",
            }}
          />
        </span>
      )}
    </button>
  );
}
