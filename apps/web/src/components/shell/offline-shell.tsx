import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { CloudOff, Download, LoaderCircle, Moon, RefreshCw, Search, Settings, Sun, Tv, UsersRound } from "lucide-react";
import { TopBar, nav, useSearchShortcut } from "@/components/shell/top-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useTheme } from "@/lib/theme";
import { downloadBridge, downloadGroups, searchDownloads, useDownloads } from "@/lib/downloads";
import { cn } from "@/lib/utils";

function OfflineSidebar() {
  const { pathname } = useLocation();
  const { library } = useDownloads();
  const groups = downloadGroups(library?.items.filter((i) => i.status === "complete") ?? []);
  return <aside className="channel-rail sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 flex-col px-3 pt-2 pb-4 lg:flex">
    <nav aria-label="Primary" className="space-y-0.5">
      {[...nav, { to: "/settings", label: "Settings", icon: Settings, end: false }].map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("text-muted-foreground hover:bg-muted hover:text-foreground relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", (isActive || (to === "/downloads" && pathname.startsWith("/watch/"))) && "bg-secondary text-foreground before:bg-brand before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full")}><Icon className="size-[18px]" />{label}</NavLink>)}
    </nav>
    <h2 className="mt-8 mb-3 px-3 text-sm font-semibold">Downloaded</h2>
    <ul className="no-scrollbar min-h-0 space-y-0.5 overflow-y-auto">
      {groups.map((group) => <li key={group.key}><Link to={`/downloads?group=${encodeURIComponent(group.key)}`} className="hover:bg-muted flex items-center gap-3 rounded-xl px-3 py-2 text-sm"><span className="text-muted-foreground">{group.items[0]?.video.episode ? <Tv className="size-4" /> : <UsersRound className="size-4" />}</span><span className="min-w-0 flex-1 truncate">{group.name}</span><span className="text-muted-foreground text-xs tabular-nums">{group.items.length}</span></Link></li>)}
    </ul>
    {!groups.length && <p className="text-muted-foreground px-3 text-xs">Your saved channels and shows appear here.</p>}
    <div className="text-muted-foreground mt-auto px-3 pt-6 text-xs"><p className="truncate">{library?.profileName}</p><p className="mt-2 flex items-center gap-1.5"><CloudOff className="size-3" />Offline library</p></div>
  </aside>;
}

function OfflineSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const { library } = useDownloads();
  const navigate = useNavigate();
  const matches = searchDownloads(library?.items.filter((i) => i.status === "complete") ?? [], query);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>Search downloads</DialogTitle><DialogDescription>Search saved titles, channels, shows, and descriptions on this device.</DialogDescription></DialogHeader>
    <label className="bg-secondary/50 flex items-center gap-2 rounded-full border px-4"><Search className="text-muted-foreground size-4" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search downloaded videos" aria-label="Search downloaded videos" /></label>
    <div className="max-h-80 space-y-1 overflow-y-auto" role="list" aria-label="Downloaded search results">
      {matches.map((item) => <button type="button" role="listitem" key={item.id} className="hover:bg-secondary flex w-full items-center gap-3 rounded-xl p-3 text-left" onClick={() => { onOpenChange(false); navigate(`/watch/${item.id}`); }}><Download className="text-brand size-4 shrink-0" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.video.title}</span><span className="text-muted-foreground block truncate text-xs">{item.video.episode?.seriesTitle || item.video.channelName} · {item.quality}</span></span></button>)}
      {!matches.length && <p role="status" className="text-muted-foreground py-8 text-center text-sm">No saved videos match your search.</p>}
    </div>
  </DialogContent></Dialog>;
}

function Shell() {
  const [searchOpen, setSearchOpen] = useSearchShortcut();
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  const { resolved, setTheme } = useTheme();
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const reconnect = async () => {
    setConnecting(true); setMessage("");
    try { if (!await downloadBridge()?.reconnect()) setMessage("Your server is still unavailable. You can keep watching your downloads."); }
    catch { setMessage("Could not reconnect. Try again when your server is available."); }
    finally { setConnecting(false); }
  };
  return <div className="relative isolate min-h-dvh">
    {!pathname.startsWith("/watch/") && <div className="page-glow -z-10" aria-hidden />}
    <TopBar onSearch={() => setSearchOpen(true)} actions={<>
      <span className="text-muted-foreground mr-1 flex items-center gap-1.5 text-xs"><CloudOff className="size-3.5" />Offline</span>
      <Button size="icon" variant="ghost" aria-label="Toggle theme" onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>{resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
      <Button size="sm" variant="secondary" aria-label="Reconnect" title="Reconnect to server" disabled={connecting} onClick={() => void reconnect()}>{connecting ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}<span className="hidden xl:inline">Reconnect</span></Button>
    </>} />
    <div className="flex"><OfflineSidebar /><main key={pathname} className="page-transition min-w-0 flex-1">{message && <p role="status" className="text-muted-foreground px-8 pt-4 text-sm">{message}</p>}<Outlet /></main></div>
    <OfflineSearch open={searchOpen} onOpenChange={setSearchOpen} />
  </div>;
}
export function OfflineShell() { return <Shell />; }

export function OfflineDestination() {
  const { pathname } = useLocation();
  const name = [...nav, { to: "/settings", label: "Settings" }].find((item) => item.to === pathname)?.label ?? "This page";
  return <div className="page"><PageHeader title={name} /><Empty className="mt-12 py-16"><EmptyHeader><EmptyMedia variant="icon"><CloudOff /></EmptyMedia><EmptyTitle>Offline</EmptyTitle><EmptyDescription>This page needs your Fanoos server. Your downloaded videos, metadata, and playback controls are still available.</EmptyDescription></EmptyHeader><Button asChild variant="secondary"><Link to="/downloads"><Download className="size-4" />Browse downloads</Link></Button></Empty></div>;
}
