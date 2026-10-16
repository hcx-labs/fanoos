import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  AudioLines,
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
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { SubscribeControl } from "@/components/accounts/subscribe-control";
import { ChannelAvatar } from "@/components/channel-avatar";
import { RichText } from "@/components/rich-text";
import { Player, type PlayerHandle } from "@/components/player/player";
import { VideoRow, useVideoTitle } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useData } from "@/hooks/use-data";
import { formatAgo, formatCount, formatDuration, formatViews } from "@/lib/format";
import { segmentMeta } from "@/lib/segments";
import { itemKey, paths } from "@/lib/paths";
import { languageLabel } from "@/components/player/player";
import { useSource, type CommentSort, type Rating } from "@/lib/source";
import { accountActions, useAccounts } from "@/lib/session";
import { actions, useSettings, useStore } from "@/lib/store";
import type { Channel, Comment, Segment, Video, VideoDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/use-title";

export function WatchPage() {
  const { backend = "youtube", id = "" } = useParams();
  const [params] = useSearchParams();
  const startAt = Number(params.get("t")) || undefined;
  const source = useSource();
  const { can } = useAccounts();
  // Bumped to load the video again (e.g. while the streaming service warms up).
  const [attempt, setAttempt] = useState(0);
  const state = useData(() => source.video({ backend, id }), [source.key, backend, id, attempt]);
  const { dearrow } = useSettings();
  const loaded = state.data?.video;
  useTitle(loaded ? (dearrow && loaded.altTitle ? loaded.altTitle : loaded.title) : state.status === "loading" ? null : "Video unavailable");
  const [theater, setTheater] = useState(false);
  const [time, setTime] = useState(0);
  const player = useRef<PlayerHandle>(null);
  // Switching an episode's audio language loads another id (each dub is its own episode).
  // Keep the page as it is while that loads, so only the stream changes.
  const shown = useRef<VideoDetail | null>(null);
  if (state.data) shown.current = state.data;
  const sameEpisode =
    shown.current?.video.backend === backend && (shown.current.video.id === id || shown.current.video.episode?.versions?.some((v) => v.id === id));
  const detail = state.data ?? (state.status === "loading" && sameEpisode ? shown.current : null);
  // The streaming service is warming up: check again shortly, without leaving the page.
  const starting = detail?.stream.unavailable?.code === "starting";
  useEffect(() => {
    if (!starting) return;
    const timer = window.setTimeout(() => setAttempt((n) => n + 1), 6000);
    return () => window.clearTimeout(timer);
  }, [starting, attempt]);

  if (!detail && state.status === "loading") return <WatchSkeleton />;
  if (!detail)
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

  const { video, channel, next, stream } = detail;
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
            // One player per episode, whichever language: a dub switch swaps only its stream.
            key={video.episode ? `${video.backend}:${video.episode.seriesId}:${video.episode.season}:${video.episode.number}` : itemKey(video)}
            ref={player}
            video={video}
            stream={stream}
            startAt={startAt}
            next={next[0]}
            theater={theater}
            onTheaterChange={setTheater}
            onTime={setTime}
          />
        </div>
        <div className={"min-w-0 xl:col-start-1 xl:row-start-2"}>
          <VideoInfo video={video} channel={channel} onSeek={seek} />
          {can(video.backend, "comments") && <Comments video={video} />}
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
  const later = useStore((s) => s.watchLater.includes(itemKey(video)));
  const { accountsOn, can, bySlug } = useAccounts();
  const accounts = accountsOn(video.backend);
  const writeOption = bySlug(video.backend)?.info?.link.writeOption;
  const ratings = can(video.backend, "ratings");
  const [expanded, setExpanded] = useState(false);
  // "Read more" only when the three-line clamp actually hides something.
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el || expanded) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [video.description, expanded]);
  const source = useSource();

  // Ratings act as the default account when it can, else the first account on this service that can.
  const actor = accounts.find((a) => a.canWrite);
  const initial = useData(
    () => (actor && ratings ? source.rating(actor.id, video.id).then((r) => r.rating) : Promise.resolve<Rating>("none")),
    [actor?.id, video.id, ratings],
  );
  const [vote, setVote] = useState<Rating | null>(null);
  const current: Rating = vote ?? initial.data ?? "none";

  // Public counts already include this account's earlier rating; don't count it twice.
  const likes = (video.likes ?? 0) - (initial.data === "like" ? 1 : 0) + (current === "like" ? 1 : 0);
  const dislikes = (video.dislikes ?? 0) - (initial.data === "dislike" ? 1 : 0) + (current === "dislike" ? 1 : 0);

  const rateAs = async (rating: Rating) => {
    if (!actor) {
      const first = accounts[0];
      toast("Liking needs an account that allows actions", {
        description: "Linked accounts are read-only until you allow actions.",
        action:
          first && writeOption
            ? { label: "Allow actions", onClick: () => void accountActions.link(first.backendId, "settings", { write: true, accountId: first.id }) }
            : undefined,
      });
      return;
    }
    const next: Rating = current === rating ? "none" : rating;
    const before = current;
    setVote(next);
    try {
      await source.rate(actor.id, video.id, next);
    } catch (e) {
      setVote(before);
      toast.error("Couldn't save your rating", { description: (e as Error).message });
    }
  };
  const segments = video.segments ?? [];
  const chapters = video.chapters ?? [];
  const ratio = likes / Math.max(1, likes + dislikes);
  const community = settings.dearrow && video.altTitle;

  return (
    <section className="@container mt-5">
      {video.episode && (
        <p className="text-muted-foreground mb-1.5 flex flex-wrap items-center gap-x-2 text-sm">
          <Link to={paths.channelOf(video)} className="text-foreground font-semibold hover:underline">
            {video.episode.seriesTitle}
          </Link>
          {[video.episode.seasonTitle && video.episode.seasonTitle !== video.episode.seriesTitle ? video.episode.seasonTitle : null, video.episode.number ? `Episode ${video.episode.number}` : null]
            .filter(Boolean)
            .map((part) => (
              <span key={part} className="before:mr-2 before:content-['·']">
                {part}
              </span>
            ))}
        </p>
      )}
      <div className="flex items-start gap-2">
        <h1 className="font-display text-xl leading-tight font-semibold text-pretty sm:text-2xl">{title}</h1>
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
          {ratings && (
          <div className="relative">
            <ButtonGroup>
              <Button
                variant="secondary"
                className="rounded-l-full pl-4"
                aria-pressed={current === "like"}
                title={actor ? `Like as ${actor.label}` : "Like (needs an account that allows actions)"}
                onClick={() => void rateAs("like")}
              >
                <ThumbsUp className={cn(current === "like" && "fill-current text-like")} />
                <span className="tabular-nums">{formatCount(likes)}</span>
              </Button>
              <Button
                variant="secondary"
                className="rounded-r-full pr-4"
                aria-pressed={current === "dislike"}
                title={actor ? `Dislike as ${actor.label}` : "Dislike (needs an account that allows actions)"}
                onClick={() => void rateAs("dislike")}
              >
                <ThumbsDown className={cn(current === "dislike" && "fill-current text-dislike")} />
                {settings.dislikes && can(video.backend, "dislikes") && <span className="tabular-nums">{formatCount(dislikes)}</span>}
              </Button>
            </ButtonGroup>
            {settings.dislikes && can(video.backend, "dislikes") && (
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
          )}
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
            onClick={() => actions.toggleWatchLater(itemKey(video))}
          >
            {later ? <CircleCheck className="text-brand-strong" /> : <ListPlus />} <span className="hidden @4xl:inline">{later ? "Saved" : "Save"}</span>
          </Button>
        </div>
      </div>

      <div className="bg-secondary/70 mt-5 rounded-2xl p-4 text-sm">
        <div className="flex min-w-0 items-center gap-3 font-medium whitespace-nowrap">
          <span className="shrink-0">
            {[video.episode ? null : formatViews(video), formatAgo(video.published), video.rating, video.premium ? "Premium" : null].filter(Boolean).join(" · ")}
          </span>
          {segments.length > 0 && <SegmentSummary segments={segments} />}
        </div>
        <div ref={descriptionRef} className={cn("relative mt-2 break-words whitespace-pre-line", !expanded && "line-clamp-3")}>
          <RichText text={video.description} onSeek={onSeek} maxSeconds={video.duration} />
        </div>
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
        {(clipped || expanded || chapters.length > 1) && (
          <button type="button" className="mt-2 inline-flex items-center gap-1 font-semibold" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? "Show less" : "Read more"}
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {(video.episode?.versions?.length ?? 0) > 1 && <AudioVersions video={video} />}
    </section>
  );
}

/** Other languages of this episode (each dub is its own id), as quick switches. */
function AudioVersions({ video }: { video: Video }) {
  const versions = [...(video.episode?.versions ?? [])].sort(
    (a, b) => Number(Boolean(b.original)) - Number(Boolean(a.original)) || languageLabel(a.audio).localeCompare(languageLabel(b.audio)),
  );
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground mr-1 inline-flex items-center gap-1.5 text-xs font-medium">
        <AudioLines className="size-3.5" /> Audio
      </span>
      {versions.map((v) =>
        v.audio === video.episode?.audio ? (
          <span key={v.id} className="bg-foreground text-background rounded-full px-3 py-1 text-xs font-medium">
            {languageLabel(v.audio)}
            {v.original && <span className="ml-1 opacity-70">· original</span>}
          </span>
        ) : (
          <Link
            key={v.id}
            to={paths.watch({ backend: video.backend, id: v.id })}
            replace
            state={{ samePage: true }}
            onClick={() => actions.languages({ audio: v.audio })}
            className="bg-secondary hover:bg-accent rounded-full px-3 py-1 text-xs font-medium"
          >
            {languageLabel(v.audio)}
            {v.original && <span className="text-muted-foreground ml-1">· original</span>}
          </Link>
        ),
      )}
    </div>
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
          <Info className="size-3.5" />
          {video.episode ? "The rest of this season, in order. No recommendations." : "More from this channel, then channels you follow. No recommendations."}
        </p>
        <div className="flex flex-col gap-1 px-2">
          {next.map((v) => (
            <VideoRow key={itemKey(v)} video={v} size="sm" />
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
  const first = useData(() => source.comments(video, sort), [source.key, video.backend, video.id, sort]);
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
      const page = await source.comments(video, sort, next);
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
      <CommentComposer video={video} onPosted={(c) => setMore((m) => ({ ...m, comments: [c, ...m.comments] }))} />

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
          <CommentItem key={comment.id} comment={comment} backend={video.backend} />
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

function CommentItem({ comment, reply, backend }: { comment: Comment; reply?: boolean; backend?: string }) {
  const source = useSource();
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<{ items: Comment[]; next?: string; loading: boolean; loaded: boolean }>({ items: [], loading: false, loaded: false });

  const load = async (token: string) => {
    setReplies((r) => ({ ...r, loading: true }));
    try {
      const page = await source.replies(backend, token);
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
        <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line">
          <RichText text={comment.text} />
        </p>
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
                  <CommentItem key={r.id} comment={r} reply backend={backend} />
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

/** One line: a dot per segment type (with count), the skippable total, and a breakdown on hover. */
function SegmentSummary({ segments }: { segments: Segment[] }) {
  const settings = useSettings();
  const byCategory = new Map<Segment["category"], { count: number; seconds: number }>();
  for (const s of segments) {
    const entry = byCategory.get(s.category) ?? { count: 0, seconds: 0 };
    byCategory.set(s.category, { count: entry.count + 1, seconds: entry.seconds + (s.end - s.start) });
  }
  const total = segments.reduce((t, s) => t + s.end - s.start, 0);
  const skipped = segments.filter((s) => settings.segments[s.category] === "skip").reduce((t, s) => t + s.end - s.start, 0);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="text-muted-foreground ml-auto inline-flex min-w-0 items-center gap-3 text-xs font-normal">
          <span className="inline-flex shrink-0 items-center gap-3">
            {[...byCategory].map(([category, { count }]) => (
              <span key={category} className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-full" style={{ background: segmentMeta[category].color }} />
                {count > 1 && <span className="tabular-nums">×{count}</span>}
              </span>
            ))}
          </span>
          <span className="truncate">
            {skipped > 0 ? `${formatDuration(skipped)} skipped` : `${formatDuration(total)} in segments`}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-stretch gap-1 py-2">
        {[...byCategory].map(([category, { count, seconds }]) => (
          <span key={category} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: segmentMeta[category].color }} />
            <span className="flex-1">
              {segmentMeta[category].label}
              {count > 1 ? ` ×${count}` : ""}
            </span>
            <span className="tabular-nums opacity-70">{formatDuration(seconds)}</span>
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/** Post a comment as an account that allows actions. */
function CommentComposer({ video, onPosted }: { video: Video; onPosted: (comment: Comment) => void }) {
  const videoId = video.id;
  const { accountsOn } = useAccounts();
  const source = useSource();
  const writable = accountsOn(video.backend).filter((a) => a.canWrite);
  const [as, setAs] = useState(writable[0]?.id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!writable.length)
    return (
      <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
        <Info className="size-3.5" /> To comment, allow actions for a linked account in Settings.
      </p>
    );
  const author = writable.find((a) => a.id === as) ?? writable[0]!;
  const post = async () => {
    setBusy(true);
    try {
      onPosted(await source.comment(author.id, videoId, text));
      setText("");
      toast.success("Comment posted");
    } catch (e) {
      toast.error("Couldn't post your comment", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-4 flex gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void post();
      }}
    >
      <AccountAvatar account={author} className="mt-0.5 size-9" textClassName="text-xs" />
      <div className="min-w-0 flex-1 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Add a comment as ${author.label}…`}
          rows={2}
          aria-label={`Add a comment as ${author.label}`}
          className="w-full resize-y rounded-xl border bg-transparent px-3 py-2 font-sans text-sm"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {writable.length > 1 ? (
            <Select value={author.id} onValueChange={setAs}>
              <SelectTrigger size="sm" className="mr-auto rounded-full" aria-label="Comment as">
                <span className="text-muted-foreground">Commenting as</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {writable.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground mr-auto text-xs">
              Commenting as <span className="text-foreground font-medium">{author.label}</span>
              {author.name && author.name !== author.label ? ` (${author.name})` : ""}
            </span>
          )}
          {text.trim() && (
            <>
              <Button type="button" variant="ghost" onClick={() => setText("")}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />} Comment
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
