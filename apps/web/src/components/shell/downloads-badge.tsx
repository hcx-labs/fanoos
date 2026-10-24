import { isPending, useDownloads } from "@/lib/downloads";

/** Beside "Downloads" in navigation: how many are still transferring, with overall progress. */
export function DownloadsBadge() {
  const { library } = useDownloads();
  const active = library?.items.filter(isPending) ?? [];
  if (!active.length) return null;
  const total = active.reduce((n, i) => n + i.total, 0);
  const progress = total ? active.reduce((n, i) => n + i.received, 0) / total : 0;
  return <span className="ml-auto inline-flex items-center gap-1.5" role="status" aria-label={`${active.length} downloading, ${Math.round(progress * 100)}%`}>
    <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-muted-foreground/30" />
      <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" pathLength={100} strokeDasharray={`${progress * 100} 100`} strokeLinecap="round" className="stroke-brand transition-[stroke-dasharray]" />
    </svg>
    <span className="text-xs tabular-nums">{active.length}</span>
  </span>;
}
