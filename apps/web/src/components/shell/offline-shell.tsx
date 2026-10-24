import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { CloudOff, Download, Moon, RefreshCw, Settings, Sun } from "lucide-react";
import { TopBar, nav, useNavigation, useSearchShortcut } from "@/components/shell/top-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { SearchPalette } from "@/components/shell/search-palette";
import { DownloadedChannels } from "@/components/shell/downloaded-channels";
import { DownloadsBadge } from "@/components/shell/downloads-badge";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useTheme } from "@/lib/theme";
import { downloadBridge, useDownloadNotices, useDownloads } from "@/lib/downloads";
import { cn } from "@/lib/utils";

function OfflineSidebar() {
  const nav = useNavigation();
  const { pathname } = useLocation();
  const { library } = useDownloads();
  return <aside className="channel-rail sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 flex-col px-3 pt-2 pb-4 lg:flex">
    <nav aria-label="Primary" className="space-y-0.5">
      {[...nav, { to: "/settings", label: "Settings", icon: Settings, end: false }].map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("text-muted-foreground hover:bg-muted hover:text-foreground relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", (isActive || (to === "/downloads" && pathname.startsWith("/watch/"))) && "bg-secondary text-foreground before:bg-brand before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full")}><Icon className="size-[18px]" />{label}{to === "/downloads" && <DownloadsBadge />}</NavLink>)}
    </nav>
    <DownloadedChannels />
    <div className="text-muted-foreground mt-auto px-3 pt-6 text-xs"><p className="truncate">{library?.profileName}</p><p className="mt-2 flex items-center gap-1.5"><CloudOff className="size-3" />Offline library</p></div>
  </aside>;
}


function Shell() {
  const [searchOpen, setSearchOpen] = useSearchShortcut();
  const { pathname, search } = useLocation();
  useDownloadNotices();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname, search]);
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
      <Button size="sm" variant="secondary" aria-label="Reconnect" title="Reconnect to server" disabled={connecting} onClick={() => void reconnect()}>{connecting ? <Spinner /> : <RefreshCw className="size-4" />}<span className="hidden xl:inline">Reconnect</span></Button>
    </>} />
    <div className="flex"><OfflineSidebar /><main key={pathname === "/downloads" ? pathname + search : pathname} className="page-transition min-w-0 flex-1">{message && <p role="status" className="text-muted-foreground px-8 pt-4 text-sm">{message}</p>}<Outlet /></main></div>
    <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
  </div>;
}
export function OfflineShell() { return <Shell />; }

export function OfflineDestination() {
  const { pathname } = useLocation();
  const name = [...nav, { to: "/settings", label: "Settings" }].find((item) => item.to === pathname)?.label ?? "This page";
  return <div className="page"><PageHeader title={name} /><Empty className="mt-12 py-16"><EmptyHeader><EmptyMedia variant="icon"><CloudOff /></EmptyMedia><EmptyTitle>Offline</EmptyTitle><EmptyDescription>This page needs your Fanoos server. Your downloads, with their details, subtitles and playback settings, are all still here.</EmptyDescription></EmptyHeader><Button asChild variant="secondary"><Link to="/downloads"><Download className="size-4" />Browse downloads</Link></Button></Empty></div>;
}
