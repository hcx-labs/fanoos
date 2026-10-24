import { DownloadedChannels } from "@/components/shell/downloaded-channels";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { DownloadsBadge } from "@/components/shell/downloads-badge";
import { ChevronDown, Settings } from "lucide-react";
import { ViaDots } from "@/components/accounts/account-avatar";
import { ChannelAvatar } from "@/components/channel-avatar";
import { useNavigation } from "@/components/shell/top-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/hooks/use-data";
import { brand } from "@/lib/brand";
import { itemKey, paths } from "@/lib/paths";
import { ServiceMark } from "@/components/service-mark";
import { useSource } from "@/lib/source";
import { useStore } from "@/lib/store";
import type { Channel } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Persistent left rail on wide screens: navigation and what the viewer follows (channels and shows). */
export function ChannelRail() {
  const nav = useNavigation();
  const location = useLocation();
  const downloaded = location.pathname.startsWith("/downloads");
  const context = location.pathname.startsWith("/channel/") && ["movies", "shows", "channels"].includes(location.state?.catalog) ? location.state.catalog as "movies" | "shows" | "channels" : "all";
  const section = location.pathname.startsWith("/movies") ? "movies" : location.pathname.startsWith("/shows") ? "shows" : location.pathname.startsWith("/channels") || location.pathname.startsWith("/channel/youtube/") ? "channels" : context;
  const heading = section === "movies" ? "Movies" : section === "shows" ? "Shows" : section === "channels" ? "Followed channels" : "Your sources";
  const browse = section === "all" ? "/following" : `/${section}`;
  const muted = useStore((s) => s.muted);
  const source = useSource();
  const state = useData(() => source.following({ rail: true, kind: section === "all" ? undefined : section }), [source.key, section]);
  const libraryTitles = useData(async () => {
    if (section !== "shows" && section !== "movies") return [];
    const libraries = (state.data ?? []).filter((c) => c.kind === "library" && c.libraryType === section);
    const lists = await Promise.all(libraries.map(async (library) => {
      const shows: Channel[] = []; let next: string | undefined;
      do {
        const page = await source.channel(library, undefined, { next, sort: "new" });
        shows.push(...(page.channels ?? page.videos.map((movie): Channel => ({ id: movie.id, backend: movie.backend, provider: movie.provider, kind: "movie", name: movie.title, avatar: movie.poster, poster: movie.poster, year: movie.year, unseen: 0, via: movie.via, lastActivity: movie.published ? Date.parse(movie.published) / 1000 : undefined })))); next = page.next;
      } while (next && shows.length < 100);
      return shows.slice(0, 100);
    }));
    return lists.flat();
  }, [source.key, state.data, section]);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [section]);
  const loading = state.status === "loading" || ((section === "movies" || section === "shows") && libraryTitles.status === "loading");
  const filtered = [...(state.data ?? []), ...(libraryTitles.data ?? [])]
    .filter((c) => section === "movies" ? c.kind === "movie" : section === "shows" ? c.kind === "series" : section === "channels" ? !c.kind || c.kind === "channel" : true)
    .filter((c) => !muted.includes(itemKey({ backend: c.backend, id: c.id })))
    .sort((a, b) => Number(!!b.live) - Number(!!a.live) || (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || b.unseen - a.unseen);
  const groups = section === "all" ? [filtered.filter((c) => c.kind === "library"), filtered.filter((c) => c.kind === "series"), filtered.filter((c) => !c.kind || c.kind === "channel")] : [filtered];
  const sorted = Array.from({ length: Math.max(0, ...groups.map((group) => group.length)) }, (_, index) => groups.flatMap((group) => group[index] ? [group[index]!] : [])).flat().filter((c, index, all) => all.findIndex((other) => itemKey(other) === itemKey(c)) === index).slice(0, 100);
  const shown = more ? sorted : sorted.slice(0, 8);

  return (
    // Nav and footer stay put; only the channel list scrolls, within the space left over.
    <aside className="channel-rail sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 flex-col px-3 pt-2 pb-4 lg:flex">
      <nav aria-label="Primary" className="space-y-0.5">
        {[...nav, { to: "/settings", label: "Settings", icon: Settings, end: false }].map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "text-muted-foreground hover:bg-muted hover:text-foreground relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive &&
                  "bg-secondary text-foreground before:bg-brand before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full",
              )
            }
          >
            <Icon className="size-[18px]" />
            {label}
            {to === "/downloads" && <DownloadsBadge />}
          </NavLink>
        ))}
      </nav>

      {downloaded ? <DownloadedChannels /> : <>
      <div className="mt-8 mb-2 flex items-baseline justify-between px-3">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <Link to={browse} className="text-muted-foreground hover:text-foreground text-xs">
          Browse
        </Link>
      </div>
      {loading && (
        <div className="space-y-3 px-3 pt-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      )}
      {libraryTitles.status === "error" && <p role="alert" className="text-muted-foreground px-3 text-xs">Couldn’t load saved titles. Open the catalog to try again.</p>}
      <ul
        className={cn(
          "no-scrollbar min-h-0 space-y-0.5 overflow-y-auto overscroll-contain",
          more && "pb-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]",
        )}
      >
        {shown.map((channel) => (
          <li key={`${channel.backend}:${channel.id}`}>
            <NavLink
              state={{ catalog: channel.kind === "movie" ? "movies" : channel.kind === "series" ? "shows" : section }}
              to={channel.kind === "library" ? `/${channel.libraryType === "movies" ? "movies" : "shows"}?library=${encodeURIComponent(itemKey(channel))}` : paths.channel(channel)}
              className={({ isActive }) =>
                cn("hover:bg-muted flex items-center gap-3 rounded-xl px-3 py-2", (channel.kind === "library" ? location.pathname === `/${channel.libraryType === "movies" ? "movies" : "shows"}` && new URLSearchParams(location.search).get("library") === itemKey(channel) : isActive) && "bg-secondary")
              }
            >
              {(channel.kind === "series" || channel.kind === "movie") ? (
                <span className="bg-muted grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md">
                  {channel.avatar && <img src={channel.avatar} alt="" loading="lazy" className="size-full object-cover" />}
                </span>
              ) : (
                <ChannelAvatar name={channel.name} src={channel.avatar} className="size-8" textClassName="text-[11px]" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{channel.name}</span>
                <span className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
                  <ServiceMark backend={channel.backend} />
                  {channel.kind === "library" ? channel.handle : channel.group}
                  <ViaDots via={channel.via} />
                </span>
              </span>
              {channel.live ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase">
                  <span className="size-1.5 rounded-full bg-white" /> Live
                </span>
              ) : channel.unseen > 0 ? (
                <span className="text-brand-strong inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums">
                  <span className="bg-brand size-1.5 rounded-full" />
                  {channel.unseen}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
      {sorted.length > 8 && (
        <button
          type="button"
          onClick={() => setMore(!more)}
          aria-expanded={more}
          className="text-muted-foreground hover:text-foreground mt-1 flex shrink-0 items-center gap-1 px-3 py-2 text-xs font-medium"
        >
          {more ? "Show less" : `Show ${sorted.length - 8} more`}
          <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
        </button>
      )}

      </>}
      <p className="text-muted-foreground mt-auto shrink-0 px-3 pt-6 font-mono text-[11px]" title={`Built ${new Date(__BUILD_TIME__).toLocaleString()}`}>
        {brand.name.toLowerCase()} v{__APP_VERSION__} · {__COMMIT__}
      </p>
    </aside>
  );
}
