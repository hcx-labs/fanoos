import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Search } from "lucide-react";
import { ChannelRail } from "@/components/shell/channel-rail";
import { SearchPalette } from "@/components/shell/search-palette";
import { TopBar, useNavigation, useSearchShortcut } from "@/components/shell/top-bar";
import { cn } from "@/lib/utils";
import { ArtworkGlowContext, resetArtworkGlow } from "@/lib/artwork-glow";
import { useDownloadNotices } from "@/lib/downloads";

export function Layout() {
  const nav = useNavigation();
  const [searchOpen, setSearchOpen] = useSearchShortcut();
  const { pathname, search, state } = useLocation();
  useDownloadNotices();
  const glow = !pathname.startsWith("/watch");
  const glowElement = useRef<HTMLDivElement>(null);
  // Each page mounts fresh, except navigations marked as the same page,
  // e.g. switching an episode's audio language, which only swaps the stream.
  const destination = pathname === "/downloads" ? pathname + search : pathname;
  const page = useRef(destination);
  const samePage = (state as { samePage?: boolean } | null)?.samePage === true;
  if (!samePage) page.current = destination;

  useEffect(() => {
    if (!pathname.startsWith("/channel/")) resetArtworkGlow(glowElement.current);
  }, [pathname]);

  useEffect(() => {
    if (!samePage) window.scrollTo({ top: 0 });
  }, [destination, samePage]);

  return (
    <ArtworkGlowContext value={glowElement}>
      <div className="relative isolate min-h-dvh pb-20 md:pb-0">
        {/* One glow for the whole window, so it runs behind the top bar and rail without a seam. */}
        {glow && <div ref={glowElement} aria-hidden className="page-glow -z-10" />}
        <TopBar onSearch={() => setSearchOpen(true)} />
        <div className="flex">
          <ChannelRail />
          <main key={page.current} className="page-transition min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
        <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />

        <nav
          aria-label="Primary"
          // Keep every destination, including Search, in one row as the menu grows.
          className="bg-background fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col grid-rows-1 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn("text-muted-foreground flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium", isActive && "text-foreground")
              }
            >
              <Icon className="size-5" />
              <span className="max-w-full truncate">{label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="text-muted-foreground flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium"
          >
            <Search className="size-5" />
            Search
          </button>
        </nav>
      </div>
    </ArtworkGlowContext>
  );
}
