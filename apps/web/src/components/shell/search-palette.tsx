import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { History, Lock, Search, X } from "lucide-react";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { formatDuration } from "@/lib/format";
import { paths } from "@/lib/paths";
import { suggest } from "@/lib/source";
import { actions, useStore } from "@/lib/store";

export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
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
  const search = (q: string) => {
    if (!q.trim()) return;
    actions.searched(q);
    go(paths.search(q));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-2xl! p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search videos and channels</DialogDescription>
        <Command shouldFilter={false} loop>
          <CommandInput placeholder="Search videos, channels…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[min(60vh,28rem)]">
            <CommandEmpty>Press Enter to search everywhere.</CommandEmpty>
            {query.trim() && (
              <CommandGroup>
                <CommandItem value={`search:${query}`} onSelect={() => search(query)}>
                  <Search />
                  Search for <span className="font-semibold">“{query.trim()}”</span>
                  <Kbd className="ml-auto">↵</Kbd>
                </CommandItem>
              </CommandGroup>
            )}
            {!query.trim() && searches.length > 0 && (
              <CommandGroup heading="Recent searches">
                {searches.map((q) => (
                  <CommandItem key={q} value={`recent:${q}`} onSelect={() => search(q)} className="group/item">
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
                <CommandGroup heading="Your channels">
                  {suggestions.channels.map((channel) => (
                    <CommandItem key={channel.id} value={`channel:${channel.id}`} onSelect={() => go(paths.channel(channel))}>
                      <ChannelAvatar name={channel.name} src={channel.avatar} className="size-6" textClassName="text-[10px]" />
                      {channel.name}
                      <span className="text-muted-foreground ml-auto text-xs">{channel.handle}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {suggestions.videos.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="From your subscriptions">
                  {suggestions.videos.map((video) => (
                    <CommandItem key={video.id} value={`video:${video.id}`} onSelect={() => go(paths.watch(video))}>
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
            Suggestions are computed on this device. Nothing is sent until you press Enter.
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
