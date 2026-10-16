import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { backendName, useAccounts } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * Which service an item comes from: a dot in the service's colour, with its name on hover.
 * Shown only when the viewer uses more than one service; with one it would say nothing.
 */
export function ServiceMark({ backend, className, label = false }: { backend?: string; className?: string; label?: boolean }) {
  const { bySlug, feedBackends } = useAccounts();
  const b = bySlug(backend);
  if (!b || feedBackends.length < 2) return null;
  const name = backendName(b);
  const dot = <span className="size-2 shrink-0 rounded-full" style={{ background: b.info?.color ?? "currentColor" }} />;
  if (label)
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        {dot}
        {name}
      </span>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center", className)} aria-label={`From ${name}`}>
          {dot}
        </span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

/** "S2 E5" for an episode. */
export function episodeLabel(episode: { season?: number; number?: string } | undefined): string | null {
  if (!episode) return null;
  const parts = [episode.season ? `S${episode.season}` : null, episode.number ? `E${episode.number}` : null].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
