import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Search } from "lucide-react";
import { ChannelRail } from "@/components/shell/channel-rail";
import { SearchPalette } from "@/components/shell/search-palette";
import { TopBar, nav, useSearchShortcut } from "@/components/shell/top-bar";
import { cn } from "@/lib/utils";

export function Layout() {
  const [searchOpen, setSearchOpen] = useSearchShortcut();
  const { pathname } = useLocation();
  const glow = !pathname.startsWith("/watch");

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="relative isolate min-h-dvh pb-20 md:pb-0">
      {/* One glow for the whole window, so it runs behind the top bar and rail without a seam. */}
      {glow && <div aria-hidden className="page-glow -z-10" />}
      <TopBar onSearch={() => setSearchOpen(true)} />
      <div className="flex">
        <ChannelRail />
        <main key={pathname} className="rise min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />

      <nav
        aria-label="Primary"
        className="bg-background/85 fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn("text-muted-foreground flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", isActive && "text-foreground")
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="text-muted-foreground flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium"
        >
          <Search className="size-5" />
          Search
        </button>
      </nav>
    </div>
  );
}
