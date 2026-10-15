import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { Ban, Eye, Fingerprint, Gauge, ShieldCheck, Sparkles, Trash2, Tv, Volume2, FastForward } from "lucide-react";
import { toast } from "sonner";
import { AccountsManager } from "@/components/accounts/accounts-manager";
import { AgeRestrictedSetup } from "@/components/age-restricted-setup";
import { ChannelAvatar } from "@/components/channel-avatar";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { segmentMeta, segmentOrder } from "@/lib/segments";
import { authActions, useProfile } from "@/lib/session";
import { actions, useSettings, type SegmentAction, type Settings } from "@/lib/store";
import { useTheme, type Theme } from "@/lib/theme";

const sections = [
  { id: "profile", label: "Account" },
  { id: "accounts", label: "Linked accounts" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
  { id: "segments", label: "Sponsor skipping" },
  { id: "age-restricted", label: "Age-restricted", ownerOnly: true },
  { id: "playback", label: "Playback" },
  { id: "feed", label: "Feed & titles" },
  { id: "shortcuts", label: "Shortcuts" },
];

export function SettingsPage() {
  const settings = useSettings();
  const { theme, setTheme } = useTheme();
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const profile = useProfile();
  // Client-side navigation doesn't scroll to #anchors on its own.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [hash]);
  // Report the result of a Google link round trip, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const error = params.get("link_error");
    if (params.has("linked")) toast.success("Account linked", { description: "Its subscriptions are now part of your feed." });
    if (error)
      toast.error("Linking didn't finish", {
        description:
          {
            not_configured: "Google sign-in isn't set up on this server.",
            access_denied: "Access wasn't granted on Google's page.",
            expired: "The sign-in took too long or was opened in another session. Try again.",
            scope: "YouTube access wasn't granted. Tick the YouTube permission when Google asks.",
          }[error] ?? "Try again.",
      });
    if (params.has("linked") || error) navigate(`/settings${hash}`, { replace: true });
  }, [search, hash, navigate]);
  const toggle = (key: keyof Settings) => (on: boolean) => actions.setting(key, on as never);

  return (
    <div className="page grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <h1 className="font-display text-3xl font-semibold">Settings</h1>
        <nav aria-label="Settings sections" className="no-scrollbar mt-6 flex gap-1 overflow-x-auto lg:flex-col">
          {sections.filter((s) => !("ownerOnly" in s) || profile?.owner).map((s) => (
            <a key={s.id} href={`#${s.id}`} className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-3 py-1.5 text-sm whitespace-nowrap">
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="max-w-4xl space-y-12">
        <Group id="profile" title={`${brand.name} account`} description="Your own account here. It holds your linked accounts and settings, synced across devices.">
          <div className="flex flex-wrap items-center gap-4 p-4">
            <ChannelAvatar name={profile?.name ?? "?"} className="size-12" textClassName="text-sm" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{profile?.name}</p>
              <p className="text-muted-foreground text-xs">
                {profile?.email} · {profile?.passkeys ? `${profile.passkeys} passkey${profile.passkeys === 1 ? "" : "s"}` : "no passkeys"}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                authActions
                  .passkeyRegister()
                  .then(() => toast.success("Passkey added"))
                  .catch((e: Error) => {
                    if (e.name !== "NotAllowedError") toast.error("Couldn't add the passkey", { description: e.message });
                  })
              }
            >
              <Fingerprint /> Add a passkey
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await authActions.signOut();
                navigate("/welcome");
              }}
            >
              Sign out
            </Button>
          </div>
        </Group>

        <Group
          id="accounts"
          title="Linked accounts"
          description="YouTube accounts linked to your profile, grouped by the backend each one signs in through. All of them merge into one feed; the default account is used for likes, comments and subscribing unless you pick another."
          bare
        >
          <AccountsManager />
        </Group>

        <Group id="appearance" title="Appearance">
          <Row icon={Tv} title="Theme">
            <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(v) => v && setTheme(v as Theme)}>
              {(["dark", "light", "system"] as const).map((t) => (
                <ToggleGroupItem key={t} value={t} className="data-[state=on]:bg-foreground data-[state=on]:text-background px-3 capitalize">
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Row>
        </Group>

        <Group id="privacy" title="Privacy" description="What's stored, and where it goes. History, searches and preferences are saved to your Fanoos account on this server, never sent to Google.">
          <Row icon={ShieldCheck} title="Video and images go through your server" description="Google sees the server's address instead of yours; your browser never contacts YouTube.">
            <span className="text-like text-sm font-medium">Always on</span>
          </Row>
          <Row icon={Eye} title="Keep watch history" description="Saved to your Fanoos account, so it follows you across devices. Powers ‘Continue watching’.">
            <Switch checked={settings.keepHistory} onCheckedChange={toggle("keepHistory")} />
          </Row>
          <Row icon={Eye} title="Keep recent searches" description="Shown in the search palette. Saved to your Fanoos account.">
            <Switch checked={settings.keepSearches} onCheckedChange={toggle("keepSearches")} />
          </Row>
          <Row icon={Ban} title="Ads" description="Blocked at the source — ad streams are never requested.">
            <span className="text-like text-sm font-medium">Always on</span>
          </Row>
          <Row icon={Trash2} title="Erase history and preferences" description="Clears watch history, playback positions, searches, Watch later and preferences from your account. Linked accounts stay connected.">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                actions.reset();
                toast.success("History and preferences erased");
              }}
            >
              Erase
            </Button>
          </Row>
        </Group>

        <Group
          id="segments"
          title="Sponsor skipping"
          description="Crowd-sourced segments from SponsorBlock. Choose what happens when one starts."
        >
          {segmentOrder.map((category) => (
            <Row
              key={category}
              swatch={segmentMeta[category].color}
              title={segmentMeta[category].label}
              description={segmentMeta[category].description}
            >
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={settings.segments[category]}
                onValueChange={(v) => v && actions.segment(category, v as SegmentAction)}
                aria-label={`${segmentMeta[category].label} action`}
              >
                {(["skip", "mute", "show", "off"] as const).map((a) => (
                  <ToggleGroupItem key={a} value={a} className="data-[state=on]:bg-foreground data-[state=on]:text-background px-2.5 text-xs capitalize">
                    {a === "show" ? "Ask" : a}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Row>
          ))}
        </Group>

        {profile?.owner && (
          <Group
            id="age-restricted"
            title="Age-restricted videos"
            description="A server-wide setting, shown only to the server's owner."
          >
            <AgeRestrictedSetup />
          </Group>
        )}

        <Group id="playback" title="Playback">
          <Row icon={Gauge} title="Default speed">
            <Select value={String(settings.speed)} onValueChange={(v) => actions.setting("speed", Number(v))}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s === 1 ? "Normal" : `${s}×`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row icon={Sparkles} title="Preferred quality">
            <Select value={settings.quality} onValueChange={(v) => actions.setting("quality", v as Settings["quality"])}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["auto", "2160p", "1440p", "1080p", "720p", "480p"] as const).map((q) => (
                  <SelectItem key={q} value={q}>
                    {q === "auto" ? "Auto" : q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row icon={Sparkles} title="Ambient mode" description="A soft glow from the video's colours behind the player.">
            <Switch checked={settings.ambient} onCheckedChange={toggle("ambient")} />
          </Row>
          <Row icon={FastForward} title="Autoplay next video">
            <Switch checked={settings.autoplayNext} onCheckedChange={toggle("autoplayNext")} />
          </Row>
          <Row icon={Volume2} title="Captions by default">
            <Switch checked={settings.captions} onCheckedChange={toggle("captions")} />
          </Row>
        </Group>

        <Group id="feed" title="Feed & titles">
          <Row title="Show dislike counts" description="Estimates from Return YouTube Dislike, with a like ratio bar.">
            <Switch checked={settings.dislikes} onCheckedChange={toggle("dislikes")} />
          </Row>
          <Row title="Community titles" description="Replace clickbait titles with crowd-sourced ones from DeArrow.">
            <Switch checked={settings.dearrow} onCheckedChange={toggle("dearrow")} />
          </Row>
          <Row title="Hide watched videos" description="Anything you've finished disappears from the home feed.">
            <Switch checked={settings.hideWatched} onCheckedChange={toggle("hideWatched")} />
          </Row>
        </Group>

        <Group id="shortcuts" title="Keyboard shortcuts">
          <div className="grid gap-x-8 gap-y-2.5 p-4 text-sm sm:grid-cols-2">
            {[
              ["Play / pause", ["K", "Space"]],
              ["Back / forward 10s", ["J", "L"]],
              ["Back / forward 5s", ["←", "→"]],
              ["Volume", ["↑", "↓"]],
              ["Mute", ["M"]],
              ["Full screen", ["F"]],
              ["Theater mode", ["T"]],
              ["Picture in picture", ["I"]],
              ["Speed down / up", ["<", ">"]],
              ["Jump to 0–90%", ["0–9"]],
              ["Frame step (paused)", [",", "."]],
              ["Search", ["/", "⌘K"]],
            ].map(([label, keys]) => (
              <div key={label as string} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="flex gap-1">
                  {(keys as string[]).map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Group>
      </div>
    </div>
  );
}

function Group({ id, title, description, bare, children }: { id: string; title: string; description?: string; bare?: boolean; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="font-display text-xl font-semibold">
        {title}
      </h2>
      {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      {bare ? <div className="mt-4">{children}</div> : <div className="bg-card mt-4 divide-y overflow-hidden rounded-2xl border">{children}</div>}
    </section>
  );
}

function Row({
  icon: Icon,
  swatch,
  title,
  description,
  children,
}: {
  icon?: typeof ShieldCheck;
  swatch?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      {Icon && (
        <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
          <Icon className="size-4" />
        </span>
      )}
      {swatch && <span className="size-3 shrink-0 rounded-full" style={{ background: swatch }} />}
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
