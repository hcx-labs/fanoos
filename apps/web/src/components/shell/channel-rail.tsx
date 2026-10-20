import { DownloadedChannels } from "@/components/shell/downloaded-channels";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
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
import { cn } from "@/lib/utils";

/** Persistent left rail on wide screens: navigation and what the viewer follows (channels and shows). */
export function ChannelRail() {
  const nav = useNavigation();
  const downloaded = useLocation().pathname.startsWith("/downloads");
  const muted = useStore((s) => s.muted);
  const source = useSource();
  const state = useData(() => source.following(), [source.key]);
  const [more, setMore] = useState(false);
  const sorted = (state.data ?? [])
    .filter((c) => !muted.includes(itemKey({ backend: c.backend, id: c.id })))
    .sort((a, b) => Number(!!b.live) - Number(!!a.live) || b.unseen - a.unseen);
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
          </NavLink>
        ))}
      </nav>

      {downloaded ? <DownloadedChannels /> : <>
      <div className="mt-8 mb-2 flex items-center justify-between px-3">
        <h2 className="text-sm font-semibold">Following</h2>
        <Link to="/following" className="text-muted-foreground hover:text-foreground text-xs">
          Manage
        </Link>
      </div>
      {state.status === "loading" && (
        <div className="space-y-3 px-3 pt-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      )}
      <ul
        className={cn(
          "no-scrollbar min-h-0 space-y-0.5 overflow-y-auto overscroll-contain",
          more && "pb-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]",
        )}
      >
        {shown.map((channel) => (
          <li key={`${channel.backend}:${channel.id}`}>
            <NavLink
              to={paths.channel(channel)}
              className={({ isActive }) =>
                cn("hover:bg-muted flex items-center gap-3 rounded-xl px-3 py-2", isActive && "bg-secondary")
              }
            >
              {channel.kind === "series" ? (
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
                  {channel.group}
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
