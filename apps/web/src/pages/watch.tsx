import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Heart,
  Info,
  ListPlus,
  Pin,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Wand2,
} from "lucide-react";
import { SubscribeControl } from "@/components/accounts/subscribe-control";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Player, type PlayerHandle } from "@/components/player/player";
import { VideoRow, useVideoTitle } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useData } from "@/hooks/use-data";
import { formatAgo, formatCount, formatDuration } from "@/lib/format";
import { segmentMeta } from "@/lib/segments";
import { paths } from "@/lib/paths";
import { useSource, type CommentSort } from "@/lib/source";
import { useAccounts } from "@/lib/session";
import { actions, useSettings, useStore } from "@/lib/store";
import type { Channel, Comment, Video } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WatchPage() {
  const { id = "" } = useParams();
  const source = useSource();
  const state = useData(() => source.video(id), [source.key, id]);
  const [theater, setTheater] = useState(false);
  const [time, setTime] = useState(0);
  const player = useRef<PlayerHandle>(null);

  if (state.status === "loading") return <WatchSkeleton />;
  if (state.status === "error" || !state.data)
    return (
      <Empty className="mt-24">
        <EmptyHeader>
          <EmptyTitle>Video unavailable</EmptyTitle>
          <EmptyDescription>It may have been removed, or the link is wrong.</EmptyDescription>
        </EmptyHeader>
        <Button asChild variant="outline">
          <Link to="/">Back to your feed</Link>
        </Button>
      </Empty>
    );

  const { video, channel, next, stream } = state.data;
  const seek = (t: number) => {
    player.current?.seek(t);
    player.current?.play();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // The player keeps one position in the tree in both modes; only its grid placement
  // changes. Moving it between parents would remount it and restart playback.
  return (
    <div className="pb-16">
      <div
        className="page grid gap-x-8 pb-0 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_1fr]"
      >
        <div
          className={cn("min-w-0", theater ? "xl:col-span-2" : "xl:col-start-1 xl:row-start-1")}
        >
          <Player
            key={video.id}
            ref={player}
            video={video}
            stream={stream}
            next={next[0]}
            theater={theater}
            onTheaterChange={setTheater}
            onTime={setTime}
          />
        </div>
        <div className={"min-w-0 xl:col-start-1 xl:row-start-2"}>
          <VideoInfo video={video} channel={channel} onSeek={seek} />
          <Comments video={video} />
        </div>
        <aside className={cn("mt-8 min-w-0 xl:col-start-2 xl:mt-0", theater ? "xl:row-start-2 xl:pt-5" : "xl:row-span-2 xl:row-start-1")}>
          <SidePanel video={video} next={next} time={time} onSeek={seek} />
        </aside>
      </div>
    </div>
  );
}

function VideoInfo({ video, channel, onSeek }: { video: Video; channel: Channel; onSeek: (t: number) => void }) {
  const settings = useSettings();
  const title = useVideoTitle(video);
  const later = useStore((s) => s.watchLater.includes(video.id));
  const [vote, setVote] = useState<"like" | "dislike" | null>(null);
  const { active } = useAccounts();
  const [expanded, setExpanded] = useState(false);

  const likes = (video.likes ?? 0) + (vote === "like" ? 1 : 0);
  const dislikes = (video.dislikes ?? 0) + (vote === "dislike" ? 1 : 0);
  const segments = video.segments ?? [];
  const chapters = video.chapters ?? [];
  const ratio = likes / Math.max(1, likes + dislikes);
  const community = settings.dearrow && video.altTitle;

  return (
    <section className="@container mt-5">
      <div className="flex items-start gap-2">
        <h1 className="font-display text-xl leading-tight font-semibold text-balance sm:text-2xl">{title}</h1>
        {community && (
          <HoverCard openDelay={150}>
            <HoverCardTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground mt-1 shrink-0 rounded-md p-1" aria-label="About this title">
                <Wand2 className="size-4" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent className="w-80 text-sm">
              <p className="font-semibold">Community title</p>
              <p className="text-muted-foreground mt-1 text-xs">Replaced by DeArrow. The original title was:</p>
              <p className="bg-muted mt-2 rounded-md p-2 text-xs">{video.title}</p>
            </HoverCardContent>
          </HoverCard>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={paths.channel(channel)}>
            <ChannelAvatar name={channel.name} src={channel.avatar} className="size-11" textClassName="text-sm" />
          </Link>
          <div className="min-w-0">
            <Link to={paths.channel(channel)} className="flex items-center gap-1 font-semibold hover:underline">
              <span className="truncate">{channel.name}</span>
              {channel.verified && <Check className="bg-muted-foreground text-background size-3.5 shrink-0 rounded-full p-0.5" />}
            </Link>
            {channel.subscribers ? <p className="text-muted-foreground text-xs">{formatCount(channel.subscribers)} subscribers</p> : null}
          </div>
          <div className="ml-2">
            <SubscribeControl channel={channel} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <ButtonGroup>
              <Button
                variant="secondary"
                className="rounded-l-full pl-4"
                aria-pressed={vote === "like"}
                title={active ? `Like as ${active.label}` : undefined}
                onClick={() => setVote(vote === "like" ? null : "like")}
              >
                <ThumbsUp className={cn(vote === "like" && "fill-current text-like")} />
                <span className="tabular-nums">{formatCount(likes)}</span>
              </Button>
              <Button
                variant="secondary"
                className="rounded-r-full pr-4"
                aria-pressed={vote === "dislike"}
                title={active ? `Dislike as ${active.label}` : undefined}
                onClick={() => setVote(vote === "dislike" ? null : "dislike")}
              >
                <ThumbsDown className={cn(vote === "dislike" && "fill-current text-dislike")} />
                {settings.dislikes && <span className="tabular-nums">{formatCount(dislikes)}</span>}
              </Button>
            </ButtonGroup>
            {settings.dislikes && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="bg-dislike/60 absolute inset-x-4 -bottom-2 h-[3px] overflow-hidden rounded-full" aria-label={`${Math.round(ratio * 100)}% liked`}>
                    <div className="bg-like h-full rounded-full" style={{ width: `${ratio * 100}%` }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {Math.round(ratio * 100)}% liked · dislikes estimated by Return YouTube Dislike
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <Button
            variant="secondary"
            className="rounded-full px-3 @4xl:px-4"
            aria-label="Share"
            onClick={() => {
              void navigator.clipboard?.writeText(`${location.origin}${paths.watch(video)}`);
              toast.success("Link copied", { description: "Clean link — no tracking parameters." });
            }}
          >
            <Share2 /> <span className="hidden @4xl:inline">Share</span>
          </Button>
          <Button
            variant="secondary"
            className="rounded-full px-3 @4xl:px-4"
            aria-label={later ? "Remove from Watch later" : "Save to Watch later"}
            aria-pressed={later}
            onClick={() => actions.toggleWatchLater(video.id)}
          >
            {later ? <CircleCheck className="text-brand-strong" /> : <ListPlus />} <span className="hidden @4xl:inline">{later ? "Saved" : "Save"}</span>
          </Button>
        </div>
      </div>

      <div className="bg-secondary/70 mt-5 rounded-2xl p-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-medium">
          <span>
            {[video.views ? `${formatCount(video.views)} views` : null, formatAgo(video.published) || null].filter(Boolean).join(" · ")}
          </span>
          {segments.length > 0 && (
            <span className="inline-flex flex-wrap gap-1">
              {segments.map((s, i) => (
                <Badge key={i} variant="outline" className="gap-1.5 text-[11px]">
                  <span className="size-1.5 rounded-full" style={{ background: segmentMeta[s.category].color }} />
                  {segmentMeta[s.category].label}
                </Badge>
              ))}
            </span>
          )}
        </div>
        <div className={cn("relative mt-2 whitespace-pre-line", !expanded && "line-clamp-3")}>{video.description}</div>
        {expanded && chapters.length > 1 && (
          <div className="mt-4">
            <p className="mb-2 font-semibold">Chapters</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {chapters.map((chapter) => (
                <li key={chapter.start}>
                  <button type="button" className="hover:bg-background/70 flex w-full gap-3 rounded-md px-2 py-1 text-left" onClick={() => onSeek(chapter.start)}>
                    <span className="text-brand-strong w-12 font-medium tabular-nums">{formatDuration(chapter.start)}</span>
                    {chapter.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="mt-2 inline-flex items-center gap-1 font-semibold" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "Show less" : "…more"}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>
    </section>
  );
}

function SidePanel({ video, next, time, onSeek }: { video: Video; next: Video[]; time: number; onSeek: (t: number) => void }) {
  const settings = useSettings();
  const chapters = video.chapters ?? [];
  const current = [...chapters].reverse().find((c) => time >= c.start);
  return (
    <Tabs defaultValue="next" className="bg-card gap-0 overflow-hidden rounded-2xl border xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)]">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <TabsList>
          <TabsTrigger value="next">Up next</TabsTrigger>
          {chapters.length > 1 && <TabsTrigger value="chapters">Chapters</TabsTrigger>}
        </TabsList>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="autoplay" className="text-muted-foreground text-xs">
            Autoplay
          </Label>
          <Switch id="autoplay" size="sm" checked={settings.autoplayNext} onCheckedChange={(on) => actions.setting("autoplayNext", on)} />
        </div>
      </div>
      <TabsContent value="next" className="min-h-0 overflow-y-auto p-3">
        <p className="text-muted-foreground mb-2 flex items-center gap-1.5 px-1 text-xs">
          <Info className="size-3.5" /> More from this channel, then channels you follow. No recommendations.
        </p>
        <div className="flex flex-col gap-1 px-2">
          {next.map((v) => (
            <VideoRow key={v.id} video={v} size="sm" />
          ))}
        </div>
      </TabsContent>
      <TabsContent value="chapters" className="min-h-0 overflow-y-auto p-1.5">
        <ol>
          {chapters.map((chapter, i) => {
            const active = current === chapter;
            return (
              <li key={chapter.start}>
                <button
                  type="button"
                  onClick={() => onSeek(chapter.start)}
                  className={cn(
                    "hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm",
                    active && "bg-brand-soft hover:bg-brand-soft",
                  )}
                  aria-current={active || undefined}
                >
                  <span className={cn("text-muted-foreground w-5 text-center text-xs tabular-nums", active && "text-brand-strong font-bold")}>{i + 1}</span>
                  <span className={cn("flex-1 truncate", active && "font-semibold")}>{chapter.title}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">{formatDuration(chapter.start)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </TabsContent>
    </Tabs>
  );
}

function Comments({ video }: { video: Video }) {
  const [sort, setSort] = useState<CommentSort>("top");
  const source = useSource();
  const first = useData(() => source.comments(video.id, sort), [source.key, video.id, sort]);
  const [more, setMore] = useState<{ comments: Comment[]; next?: string; loading: boolean }>({ comments: [], loading: false });
  // Extra pages reset whenever the first page reloads.
  const [seen, setSeen] = useState(first);
  if (seen !== first) {
    setSeen(first);
    setMore({ comments: [], loading: false });
  }
  const next = more.next ?? (more.comments.length ? undefined : first.data?.next);
  const total = first.data?.count ?? video.commentCount;

  const loadMore = async () => {
    if (!next) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const page = await source.comments(video.id, sort, next);
      setMore((m) => ({ comments: [...m.comments, ...page.comments], next: page.next, loading: false }));
    } catch (e) {
      setMore((m) => ({ ...m, loading: false }));
      toast.error("Couldn't load more comments", { description: (e as Error).message });
    }
  };

  return (
    <section className="mt-8" aria-labelledby="comments">
      <div className="flex flex-wrap items-center gap-4">
        <h2 id="comments" className="font-display text-lg font-semibold">
          {total ? `${formatCount(total)} comments` : "Comments"}
        </h2>
        <Tabs value={sort} onValueChange={(value) => setSort(value as CommentSort)}>
          <TabsList>
            <TabsTrigger value="top">Top</TabsTrigger>
            <TabsTrigger value="new">Newest</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
        <Info className="size-3.5" /> Read-only for now: linked accounts can't post comments yet.
      </p>

      <div className="mt-6 space-y-6">
        {first.status === "loading" &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-4 w-full max-w-lg" />
              </div>
            </div>
          ))}
        {first.status === "error" && <p className="text-muted-foreground text-sm">Comments couldn't be loaded. {first.error.message}</p>}
        {first.status === "ready" && !first.data.comments.length && <p className="text-muted-foreground text-sm">No comments, or comments are turned off.</p>}
        {[...(first.data?.comments ?? []), ...more.comments].map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
        {next && (
          <Button variant="outline" className="rounded-full" onClick={() => void loadMore()} disabled={more.loading}>
            {more.loading && <Spinner />} Show more comments
          </Button>
        )}
      </div>
    </section>
  );
}

function CommentItem({ comment, reply }: { comment: Comment; reply?: boolean }) {
  const source = useSource();
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<{ items: Comment[]; next?: string; loading: boolean; loaded: boolean }>({ items: [], loading: false, loaded: false });

  const load = async (token: string) => {
    setReplies((r) => ({ ...r, loading: true }));
    try {
      const page = await source.replies(token);
      setReplies((r) => ({ items: [...r.items, ...page.comments], next: page.next, loading: false, loaded: true }));
    } catch (e) {
      setReplies((r) => ({ ...r, loading: false }));
      toast.error("Couldn't load replies", { description: (e as Error).message });
    }
  };

  return (
    <article className="flex gap-3">
      <ChannelAvatar name={comment.author.replace(/^@/, "")} src={comment.avatar} className={reply ? "size-7" : "size-9"} textClassName="text-[11px]" />
      <div className="min-w-0 flex-1">
        {comment.pinned && (
          <p className="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
            <Pin className="size-3" /> Pinned
          </p>
        )}
        <p className="flex items-center gap-2 text-xs">
          <span className={cn("font-semibold", comment.byCreator && "bg-foreground text-background rounded-full px-2 py-0.5")}>{comment.author}</span>
          <span className="text-muted-foreground">{comment.publishedText}</span>
        </p>
        <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line">{comment.text}</p>
        <div className="text-muted-foreground mt-1.5 flex items-center gap-3 text-xs">
          {comment.likes > 0 && (
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="size-3.5" /> {formatCount(comment.likes)}
            </span>
          )}
          {comment.hearted && (
            <span className="text-dislike inline-flex items-center gap-1" title="Hearted by the creator">
              <Heart className="size-3.5 fill-current" />
            </span>
          )}
        </div>
        {comment.replies && comment.replyCount > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="text-brand-strong -ml-2 rounded-full font-semibold"
              aria-expanded={open}
              onClick={() => {
                setOpen(!open);
                if (!replies.loaded && !replies.loading) void load(comment.replies!);
              }}
            >
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
              {formatCount(comment.replyCount)} {comment.replyCount === 1 ? "reply" : "replies"}
            </Button>
            {open && (
              <div className="mt-3 space-y-4">
                {replies.items.map((r) => (
                  <CommentItem key={r.id} comment={r} reply />
                ))}
                {replies.loading && <Spinner className="text-muted-foreground" />}
                {replies.next && !replies.loading && (
                  <Button variant="ghost" size="sm" className="text-brand-strong -ml-2 rounded-full font-semibold" onClick={() => void load(replies.next!)}>
                    Show more replies
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function WatchSkeleton() {
  return (
    <div className="page grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="mt-5 h-7 w-2/3" />
        <div className="mt-4 flex gap-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="mt-5 h-28 w-full rounded-2xl" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="aspect-video w-40 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
