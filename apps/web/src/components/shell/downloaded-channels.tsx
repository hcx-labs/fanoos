import { Link, useLocation, useSearchParams } from "react-router";
import { Tv, UsersRound } from "lucide-react";
import { downloadGroups, useDownloads } from "@/lib/downloads";
import { cn } from "@/lib/utils";

export function DownloadedChannels() {
  const { library } = useDownloads();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const selected = pathname === "/downloads" ? params.get("group") : null;
  const groups = downloadGroups(library?.items.filter((item) => item.status === "complete") ?? []);
  return <>
    <h2 className="mt-8 mb-3 px-3 text-sm font-semibold">Downloaded</h2>
    <ul aria-label="Downloaded channels and shows" className="no-scrollbar min-h-0 space-y-0.5 overflow-y-auto">
      {groups.map((group) => <li key={group.key}><Link to={`/downloads?group=${encodeURIComponent(group.key)}`} aria-current={selected === group.key ? "page" : undefined} className={cn("hover:bg-muted flex items-center gap-3 rounded-xl px-3 py-2 text-sm", selected === group.key && "bg-secondary text-foreground font-medium")}>
        <span className="text-muted-foreground">{group.items[0]?.video.episode ? <Tv className="size-4" /> : <UsersRound className="size-4" />}</span><span className="min-w-0 flex-1 truncate">{group.name}</span><span className="text-muted-foreground text-xs tabular-nums">{group.items.length}</span>
      </Link></li>)}
    </ul>
    {!groups.length && <p className="text-muted-foreground px-3 text-xs">Your saved channels and shows appear here.</p>}
  </>;
}
