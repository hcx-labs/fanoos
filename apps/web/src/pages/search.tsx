import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, SearchX, ShieldCheck } from "lucide-react";
import { ChannelAvatar } from "@/components/channel-avatar";
import { VideoRow } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useData } from "@/hooks/use-data";
import { formatCount } from "@/lib/format";
import { paths } from "@/lib/paths";
import { useSource, type SearchFilters } from "@/lib/source";

const defaults: SearchFilters = { type: "all", duration: "any", uploaded: "any", sort: "relevance" };

export function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";
  const [filters, setFilters] = useState(defaults);
  const source = useSource();
  const state = useData(() => source.search(query, filters), [source.key, query, filters]);
  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const changed = JSON.stringify(filters) !== JSON.stringify(defaults);

  return (
    <div className="page">
      <div className="max-w-5xl">
      <p className="text-muted-foreground text-sm">Results for</p>
      <h1 className="font-display text-3xl font-semibold">“{query}”</h1>
      <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
        <ShieldCheck className="text-brand size-3.5" />
        Searched through your backend, signed out. YouTube doesn't see who asked, and nothing is personalised.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-b pb-4">
        <ToggleGroup type="single" value={filters.type} onValueChange={(v) => v && set("type", v as SearchFilters["type"])} spacing={1}>
          {(["all", "video", "channel"] as const).map((type) => (
            <ToggleGroupItem
              key={type}
              value={type}
              className="data-[state=on]:bg-foreground data-[state=on]:text-background bg-secondary h-8 rounded-full px-4 text-[13px] capitalize"
            >
              {type === "all" ? "All" : `${type}s`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="ml-auto flex flex-wrap gap-2">
          <Filter value={filters.uploaded} onChange={(v) => set("uploaded", v)} label="Upload date" options={{ any: "Any time", today: "Today", week: "This week", month: "This month" }} />
          <Filter value={filters.duration} onChange={(v) => set("duration", v)} label="Duration" options={{ any: "Any length", short: "Under 3 min", medium: "3–20 min", long: "Over 20 min" }} />
          <Filter value={filters.sort} onChange={(v) => set("sort", v)} label="Sort" options={{ relevance: "Relevance", date: "Newest", views: "Most viewed" }} />
          {changed && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setFilters(defaults)}>
              Reset
            </Button>
          )}
        </div>
      </div>

      {state.status === "loading" && (
        <div className="mt-6 space-y-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="aspect-video w-2/5 max-w-[22rem] rounded-xl" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {state.status === "ready" && (
        <div className="mt-6 space-y-6">
          {state.data.channels.map((channel) => (
            <Link key={channel.id} to={paths.channel(channel)} className="hover:bg-muted/60 flex items-center gap-5 rounded-2xl p-3">
              <div className="grid w-2/5 max-w-[22rem] place-items-center">
                <ChannelAvatar name={channel.name} src={channel.avatar} className="size-24" textClassName="text-2xl" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-lg font-semibold">
                  {channel.name}
                  {channel.verified && <Check className="bg-muted-foreground text-background size-4 rounded-full p-0.5" />}
                </p>
                <p className="text-muted-foreground text-xs">
                  {[channel.handle, channel.subscribers ? `${formatCount(channel.subscribers)} subscribers` : null].filter(Boolean).join(" · ")}
                </p>
                <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{channel.description}</p>
              </div>
            </Link>
          ))}
          {state.data.videos.map((video) => (
            <VideoRow key={video.id} video={video} />
          ))}
          {!state.data.channels.length && !state.data.videos.length && (
            <Empty className="mt-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>No results</EmptyTitle>
                <EmptyDescription>Try fewer words or loosen the filters.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function Filter<T extends string>({
  value,
  onChange,
  label,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  label: string;
  options: Record<T, string>;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="rounded-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(options) as [T, string][]).map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
