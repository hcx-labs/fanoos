import { Link } from "react-router";
import { Clock3, CircleCheck, Radio } from "lucide-react";
import { ViaDots } from "@/components/accounts/account-avatar";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAgo, formatCount, formatDuration } from "@/lib/format";
import { paths } from "@/lib/paths";
import { segmentMeta } from "@/lib/segments";
import { actions, useProgress, useSettings, useStore } from "@/lib/store";
import type { Video } from "@/lib/types";
import { cn } from "@/lib/utils";

export function useVideoTitle(video: Video) {
  const { dearrow } = useSettings();
  return dearrow && video.altTitle ? video.altTitle : video.title;
}

export function Thumbnail({ video, className, size = "md" }: { video: Video; className?: string; size?: "sm" | "md" | "lg" }) {
  const later = useStore((s) => s.watchLater.includes(video.id));
  const settings = useSettings();
  const skipped = (video.segments ?? []).filter((s) => settings.segments[s.category] === "skip");
  const position = useProgress(video.id) ?? video.progress ?? 0;
  const watched = video.duration ? Math.min(1, position / video.duration) : 0;

  return (
    <div
      className={cn(
        "group/thumb bg-muted relative isolate aspect-video overflow-hidden",
        size === "sm" ? "rounded-lg" : "rounded-xl",
        className,
      )}
    >
      <img
        src={video.thumbnail}
        alt=""
        loading={size === "lg" ? "eager" : "lazy"}
        referrerPolicy="no-referrer"
        className="size-full object-cover transition-transform duration-500 ease-out-quint group-hover/card:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover/card:opacity-100" />

      {video.upcoming ? (
        <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">Upcoming</span>
      ) : video.live ? (
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">
          <Radio className="size-3" /> Live
        </span>
      ) : video.duration > 0 ? (
        <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
          {formatDuration(video.duration)}
        </span>
      ) : null}

      {size !== "sm" && skipped.length > 0 && (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/card:opacity-100">
          <span className="flex gap-0.5">
            {skipped.map((s, i) => (
              <span key={i} className="size-1.5 rounded-full" style={{ background: segmentMeta[s.category].color }} />
            ))}
          </span>
          {Math.round(skipped.reduce((t, s) => t + s.end - s.start, 0))}s skipped
        </span>
      )}

      {size !== "sm" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={later}
              aria-label={later ? "Remove from Watch later" : "Save to Watch later"}
              onClick={(event) => {
                event.preventDefault();
                actions.toggleWatchLater(video.id);
              }}
              className={cn(
                "absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-black/70 text-white backdrop-blur-sm transition-opacity hover:bg-black/90 focus-visible:opacity-100",
                later ? "opacity-100" : "opacity-0 group-hover/card:opacity-100",
              )}
            >
              {later ? <CircleCheck className="text-brand size-4" /> : <Clock3 className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{later ? "Saved to Watch later" : "Watch later"}</TooltipContent>
        </Tooltip>
      )}

      {watched > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
          <div className="bg-brand h-full" style={{ width: `${watched * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function Meta({ video, className }: { video: Video; className?: string }) {
  return (
    <p className={cn("text-muted-foreground text-xs", className)}>
      {[video.views ? `${formatCount(video.views)} views` : null, formatAgo(video.published) || null].filter(Boolean).join(" · ")}
      <ViaDots via={video.via} className="ml-2" />
    </p>
  );
}

/** Grid card: thumbnail above, avatar + text below. */
export function VideoCard({ video, showChannel = true }: { video: Video; showChannel?: boolean }) {
  const channel = { id: video.channelId, name: video.channelName };
  const title = useVideoTitle(video);
  return (
    <article className="group/card relative">
      <Link to={paths.watch(video)} className="block rounded-xl focus-visible:outline-offset-4">
        <Thumbnail video={video} />
        <span className="sr-only">{title}</span>
      </Link>
      <div className="mt-3 flex gap-3">
        {showChannel && (
          <Link to={paths.channel(channel)} className="shrink-0 rounded-full" aria-label={channel.name}>
            <ChannelAvatar name={channel.name} src={video.channelAvatar} className="size-9" textClassName="text-xs" />
          </Link>
        )}
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-[0.94rem] leading-snug font-semibold text-balance">
            <Link to={paths.watch(video)} className="hover:text-brand-strong" tabIndex={-1}>
              {title}
            </Link>
          </h3>
          {showChannel && (
            <Link to={paths.channel(channel)} className="text-muted-foreground hover:text-foreground mt-1 block text-xs">
              {channel.name}
            </Link>
          )}
          <Meta video={video} className={showChannel ? "" : "mt-1"} />
        </div>
      </div>
    </article>
  );
}

/** Horizontal row: used for search results, up next, and lists. */
export function VideoRow({
  video,
  size = "md",
  active,
  index,
}: {
  video: Video;
  size?: "sm" | "md";
  active?: boolean;
  index?: number;
}) {
  const channel = { id: video.channelId, name: video.channelName };
  const title = useVideoTitle(video);
  return (
    <article
      className={cn(
        "group/card relative flex gap-3 rounded-xl",
        size === "sm" && "hover:bg-muted/60 -mx-2 p-2",
        active && "bg-brand-soft/60 hover:bg-brand-soft/60",
      )}
    >
      {index !== undefined && (
        <span className="text-muted-foreground w-5 shrink-0 self-center text-center text-xs tabular-nums">{index}</span>
      )}
      <Link
        to={paths.watch(video)}
        className={cn("shrink-0", size === "sm" ? "w-40" : "w-full max-w-[22rem] min-w-40 basis-2/5")}
        aria-label={title}
      >
        <Thumbnail video={video} size={size === "sm" ? "sm" : "md"} />
      </Link>
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className={cn("line-clamp-2 leading-snug font-semibold", size === "sm" ? "text-[0.84rem]" : "text-base")}>
          <Link to={paths.watch(video)} className="after:absolute after:inset-0" tabIndex={-1}>
            {title}
          </Link>
        </h3>
        {size === "sm" ? (
          <>
            <p className="text-muted-foreground mt-1 text-xs">{channel.name}</p>
            <Meta video={video} />
          </>
        ) : (
          <>
            <Meta video={video} className="mt-1" />
            <Link
              to={paths.channel(channel)}
              className="text-muted-foreground hover:text-foreground relative z-10 mt-3 inline-flex items-center gap-2 text-xs"
            >
              <ChannelAvatar name={channel.name} src={video.channelAvatar} className="size-6" textClassName="text-[10px]" />
              {channel.name}
            </Link>
            <p className="text-muted-foreground mt-2 line-clamp-2 max-w-prose text-xs">{video.description}</p>
          </>
        )}
      </div>
    </article>
  );
}
