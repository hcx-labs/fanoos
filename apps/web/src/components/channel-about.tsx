import { useState } from "react";
import { Check, Copy, ExternalLink, Rss } from "lucide-react";
import { toast } from "sonner";
import { ChannelDescription } from "@/components/channel-description";
import { ServiceMark } from "@/components/service-mark";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/types";
import { cn } from "@/lib/utils";

function publicFeed(raw?: string): string | undefined {
  try {
    const url = new URL(raw ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function ChannelAbout({ channel }: { channel: Channel }) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const feed = publicFeed(channel.feedUrl);
  const stats = [
    ...(channel.subscribers !== undefined ? [{ label: "Subscribers", count: channel.subscribers }] : []),
    ...(channel.videoCount !== undefined ? [{ label: "Videos", count: channel.videoCount }] : []),
  ];
  const copy = async () => {
    if (!feed || copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(feed);
      setCopied(true);
      toast.success("RSS feed link copied");
    } catch {
      setCopied(false);
      toast.error("Couldn't copy the feed link", { description: "Open the feed and copy its address instead." });
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-labelledby="channel-about-description" className="bg-card min-w-0 rounded-2xl border p-5 sm:p-6">
        <h2 id="channel-about-description" className="font-display mb-5 text-lg font-semibold">Description</h2>
        <div className="max-w-3xl"><ChannelDescription channel={channel} /></div>
      </section>

      <aside aria-label="Channel information" className="min-w-0 space-y-5">
        <section aria-labelledby="channel-about-details" className="bg-card rounded-2xl border p-5">
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 id="channel-about-details" className="font-display text-base font-semibold">Channel details</h2>
            <ServiceMark backend={channel.backend} label className="text-muted-foreground text-xs" />
          </div>
          {channel.handle && <p className="text-muted-foreground mb-4 break-all text-sm">{channel.handle}</p>}
          {stats.length > 0 && (
            <dl className={cn("grid gap-4", stats.length > 1 && "grid-cols-2")}>
              {stats.map(({ label, count }) => (
                <div key={label} className="min-w-0">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{count.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {feed && (
          <section aria-labelledby="channel-about-rss" className="bg-card rounded-2xl border p-5">
            <div className="flex items-center gap-2">
              <Rss className="text-brand-strong size-4" />
              <h2 id="channel-about-rss" className="font-display text-base font-semibold">Follow with RSS</h2>
            </div>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">Get new uploads in your feed reader. No YouTube account needed.</p>
            <Button variant="outline" className="mt-4 w-full rounded-full" onClick={() => void copy()} disabled={copying}>
              {copied ? <Check /> : <Copy />}
              {copying ? "Copying…" : copied ? "Copied" : "Copy feed link"}
            </Button>
            <a href={feed} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground mt-3 flex items-center justify-center gap-1.5 rounded text-xs underline-offset-4 hover:underline">
              Open feed <ExternalLink className="size-3" />
            </a>
          </section>
        )}
      </aside>
    </div>
  );
}
