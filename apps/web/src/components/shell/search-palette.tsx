import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { History, Link2, Lock, Search, X } from "lucide-react";
import { ChannelAvatar } from "@/components/channel-avatar";
import { ServiceMark } from "@/components/service-mark";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { paths } from "@/lib/paths";
import { openLink, pathFor, useLinkPreview } from "@/lib/open-link";
import { suggest } from "@/lib/source";
import { actions, useStore } from "@/lib/store";

/**
 * The kit's CommandItem appends an invisible checkmark with margin-left: auto, which
 * splits the free space with our own right-aligned bits (×, ↵, durations). The palette
 * never shows checkmarks, so hide it.
 */
const item = "[&>svg:last-child]:hidden";

export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const searches = useStore((s) => s.searches);
  const [query, setQuery] = useState("");
  const suggestions = suggest(query);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };
  const link = useLinkPreview(query);
  const search = (q: string) => {
    if (!q.trim()) return;
    // A pasted link (YouTube, Crunchyroll…) opens what it points to instead of searching for it.
    if (link) {
      onOpenChange(false);
      if (link.result) navigate(pathFor(link.result));
      else void openLink(link.url, navigate, link.service);
      return;
    }
    actions.searched(q);
    go(paths.search(q));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-2xl! p-0 sm:max-w-xl"
        showCloseButton={false}
        // Put the caret in the search box as soon as it opens.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search videos and channels</DialogDescription>
        <Command shouldFilter={false} loop>
          <CommandInput ref={inputRef} placeholder="Search everything… or paste a link" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[min(60vh,28rem)]">
            <CommandEmpty>Press Enter to search everywhere.</CommandEmpty>
            {query.trim() && (
              <CommandGroup>
                {link ? (
                  <CommandItem className={item} value={`open:${query}`} onSelect={() => search(query)}>
                    <Link2 />
                    {link.loading ? (
                      <span className="text-muted-foreground">Looking up this {link.service} link…</span>
                    ) : !link.result ? (
                      <>Open on {link.service}</>
                    ) : link.result.type === "video" ? (
                      <>
                        Open this {link.service} {link.service === "YouTube" ? "video" : "episode"}
                        {link.result.start ? <span className="text-muted-foreground"> at {formatDuration(link.result.start)}</span> : null}
                      </>
                    ) : (
                      <>Open this {link.service} {link.service === "YouTube" ? "channel" : "show"}</>
                    )}
                    <Kbd className="ml-auto">↵</Kbd>
                  </CommandItem>
                ) : (
                  <CommandItem className={item} value={`search:${query}`} onSelect={() => search(query)}>
                    <Search />
                    Search for <span className="font-semibold">“{query.trim()}”</span>
                    <Kbd className="ml-auto">↵</Kbd>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            {!query.trim() && searches.length > 0 && (
              <CommandGroup heading="Recent searches">
                {searches.map((q) => (
                  <CommandItem key={q} value={`recent:${q}`} onSelect={() => search(q)} className={cn(item, "group/item")}>
                    <History />
                    {q}
                    <button
                      type="button"
                      aria-label={`Forget “${q}”`}
                      className="text-muted-foreground hover:text-foreground ml-auto rounded p-0.5 opacity-0 group-data-selected/item:opacity-100 hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        actions.forgetSearch(q);
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {suggestions.channels.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Following">
                  {suggestions.channels.map((channel) => (
                    <CommandItem className={item} key={`${channel.backend}:${channel.id}`} value={`channel:${channel.backend}:${channel.id}`} onSelect={() => go(paths.channel(channel))}>
                      <ChannelAvatar name={channel.name} src={channel.avatar} className="size-6" textClassName="text-[10px]" />
                      {channel.name}
                      <ServiceMark backend={channel.backend} className="ml-auto" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {suggestions.videos.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="From your feed">
                  {suggestions.videos.map((video) => (
                    <CommandItem className={item} key={`${video.backend}:${video.id}`} value={`video:${video.backend}:${video.id}`} onSelect={() => go(paths.watch(video))}>
                      <img src={video.thumbnail} alt="" referrerPolicy="no-referrer" className="aspect-video w-12 rounded object-cover" />
                      <span className="truncate">{video.title}</span>
                      <span className="text-muted-foreground ml-auto text-xs tabular-nums">{formatDuration(video.duration)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="text-muted-foreground flex items-center gap-2 border-t px-3 py-2 text-xs">
            <Lock className="size-3.5" />
            {link
              ? "Links are looked up through your Fanoos server."
              : "Suggestions are computed on this device. Nothing is sent until you press Enter."}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
