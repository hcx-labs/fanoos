import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import {
  CalendarDays,
  ChartColumn,
  Check,
  ChevronRight,
  EyeOff,
  Laptop,
  LibraryBig,
  LogOut,
  Star,
  UserPlus,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Tv,
  UsersRound,
  House,
} from "lucide-react";
import { AccountAvatar } from "@/components/accounts/account-avatar";
import { ChannelAvatar } from "@/components/channel-avatar";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScrolled } from "@/hooks/use-scrolled";
import { brand } from "@/lib/brand";
import { accountActions, authActions, backendName, useAccounts, useProfile } from "@/lib/session";
import { useSettings } from "@/lib/store";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const nav = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/following", label: "Following", icon: UsersRound },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/library", label: "Library", icon: LibraryBig },
  { to: "/analytics", label: "Analytics", icon: ChartColumn },
];

export function useSearchShortcut() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "/" && !typing) {
        // "/" only opens search; it must never close it (URLs contain slashes).
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const scrolled = useScrolled();
  return (
    <header data-scrolled={scrolled || undefined} className="top-bar sticky top-0 z-40">
      {/* Three columns from md up: equal-width sides keep the search box at the true centre of the window. */}
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 md:grid md:grid-cols-[1fr_minmax(0,28rem)_1fr] lg:px-6">
        <div className="flex min-w-0 items-center">
        <Link to="/" className="flex shrink-0 items-center rounded-lg" aria-label={`${brand.name} home`}>
          <Logo />
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex lg:hidden">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "text-muted-foreground hover:text-foreground relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  isActive && "bg-secondary text-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        </div>

        <button
          type="button"
          onClick={onSearch}
          className="bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground ml-auto flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full border px-4 text-sm transition-colors sm:max-w-md md:ml-0 md:w-full md:max-w-none"
        >
          <Search className="size-4" />
          <span className="truncate">Search<span className="hidden sm:inline"> everything</span></span>
          <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
        </button>

        <div className="flex shrink-0 items-center gap-1 md:justify-self-end">
          <PrivacyStatus />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function PrivacyStatus() {
  const settings = useSettings();
  const { accounts, feedBackends, backends } = useAccounts();
  const used = feedBackends.length ? feedBackends : backends.filter((b) => b.slug === "youtube");
  // Services that only work signed in (Crunchyroll) see what's watched there; say so plainly.
  const open = used.filter((b) => b.info && !b.info.private);
  const rows = [
    { label: "Linked accounts", value: `${accounts.length} across ${used.length} ${used.length === 1 ? "service" : "services"}`, ok: true },
    { label: "Ads", value: "Blocked", ok: true },
    ...used.map((b) => ({
      label: backendName(b),
      value: b.info?.private === false ? "Sees what you watch there" : "Can't see you",
      ok: b.info?.private !== false,
    })),
    { label: "Video traffic", value: "Proxied", ok: true },
    { label: "Sponsors", value: `${Object.values(settings.segments).filter((a) => a === "skip").length} types skipped`, ok: true },
    { label: "Watch history", value: settings.keepHistory ? "Your account only" : "Off", ok: true },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="Privacy status">
          <ShieldCheck className="text-brand size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center gap-3 border-b p-4">
          <div className="bg-brand-soft text-brand-strong grid size-10 place-items-center rounded-xl">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="font-display text-base font-semibold">{open.length ? "Private where it can be" : "You're watching privately"}</p>
            <p className="text-muted-foreground text-xs">
              {open.length
                ? `${open.map(backendName).join(" and ")} ${open.length === 1 ? "needs" : "need"} your account, so ${open.length === 1 ? "it sees" : "they see"} what you watch there.`
                : "Google sees your server, not you."}
            </p>
          </div>
        </div>
        <ul className="space-y-2.5 p-4">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-2 text-sm">
              <span className={cn("grid size-4 place-items-center rounded-full", row.ok ? "bg-like/20 text-like" : "bg-dislike/20 text-dislike")}>
                {row.ok ? <Check className="size-3" /> : <EyeOff className="size-2.5" />}
              </span>
              <span className="text-muted-foreground shrink-0 whitespace-nowrap">{row.label}</span>
              <span className="ml-auto min-w-0 flex-1 text-right font-medium break-words">{row.value}</span>
            </li>
          ))}
        </ul>
        <Link to="/settings" className="text-muted-foreground hover:text-foreground flex items-center border-t px-4 py-3 text-xs font-medium">
          Privacy & playback settings
          <ChevronRight className="ml-auto size-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Laptop },
];

function AccountMenu() {
  const profile = useProfile();
  const { backends, accounts, active, inFeed } = useAccounts();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  if (!profile) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={`${brand.name} account`}>
          <ChannelAvatar name={profile.name} className="size-8" textClassName="text-xs" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <ChannelAvatar name={profile.name} className="size-9" textClassName="text-xs" />
          <span className="min-w-0">
            <span className="text-foreground block truncate text-sm font-semibold">{profile.name}</span>
            <span className="text-muted-foreground block truncate text-xs font-normal">{profile.email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-baseline justify-between gap-2">
          <span className="text-sm">Linked accounts</span>
          <span className="text-muted-foreground text-[11px] font-normal">
            {inFeed.length} of {accounts.length} in feed
          </span>
        </DropdownMenuLabel>
        {backends.map((backend) => {
          const list = accounts.filter((a) => a.backendId === backend.id);
          if (!list.length) return null;
          return (
            <DropdownMenuGroup key={backend.id}>
              <DropdownMenuLabel className="text-muted-foreground flex items-center gap-1.5 pt-2 text-[11px] font-medium">
                <span className="size-2 rounded-full" style={{ background: backend.info?.color ?? "currentColor" }} /> {backendName(backend)}
              </DropdownMenuLabel>
              {list.map((account) => (
                <DropdownMenuCheckboxItem
                  key={account.id}
                  checked={account.inFeed}
                  onCheckedChange={(on) => void accountActions.update(account.id, { inFeed: on })}
                  onSelect={(e) => e.preventDefault()}
                  className="py-1.5"
                >
                  <AccountAvatar account={account} className="size-6" textClassName="text-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate">
                      {account.label}
                      {active?.id === account.id && <Star className="text-brand size-3 fill-current" aria-label="Default account" />}
                    </span>
                    <span className="text-muted-foreground block truncate text-[11px]">{account.email}</span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings#accounts")}>
          <UserPlus /> {accounts.length ? "Link or manage accounts" : "Link an account"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => navigate("/following")}>
            <Tv /> Manage what you follow
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            <Settings /> Settings
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Moon /> Appearance
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                {themes.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon /> {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await authActions.signOut();
            navigate("/welcome");
          }}
        >
          <LogOut /> Sign out of {brand.name}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
