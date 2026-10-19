import { useState } from "react";
import { RichText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/hooks/use-data";
import { useSource } from "@/lib/source";
import type { Channel } from "@/lib/types";

/** Mounted by the About tab, so browsing uploads doesn't wait for another YouTube request. */
export function ChannelDescription({ channel }: { channel: Channel }) {
  const source = useSource();
  const [attempt, setAttempt] = useState(0);
  const state = useData(() => source.channelAbout(channel), [source.key, channel.backend, channel.id, attempt]);
  if (state.status === "loading") {
    return (
      <div role="status" aria-label="Loading channel description" className="space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }
  const description = state.status === "ready" ? state.data.description : channel.description;
  return (
    <section aria-label="Channel description" className="min-w-0 space-y-3">
      {state.status === "error" && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-muted-foreground text-sm">Couldn't load the full description.{channel.description ? " Showing the preview." : ""}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
        </div>
      )}
      <p className="text-base leading-relaxed whitespace-pre-wrap break-words">
        <RichText text={description || "No description."} truncateLinks={false} />
      </p>
    </section>
  );
}
