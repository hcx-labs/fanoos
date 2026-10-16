import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { ArrowRight, Ban, Fingerprint, Layers, ListChecks, LogIn, ShieldCheck, ThumbsDown } from "lucide-react";
import { ConnectAccount } from "@/components/accounts/connect-account";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useTitle } from "@/hooks/use-title";
import { brand } from "@/lib/brand";
import { authActions, getAuthConfig, useAccounts, useProfile, useSession, type AuthConfig } from "@/lib/session";

const features = [
  { icon: ListChecks, title: "Only your subscriptions", text: "A chronological feed of channels you chose. No recommendations, no Shorts wall." },
  { icon: Layers, title: "Every account, one feed", text: `Link several YouTube accounts to your ${brand.name} account. Their subscriptions merge into one list.` },
  { icon: Ban, title: "No ads, no sponsors", text: "Ads are never requested. Sponsor reads are skipped using SponsorBlock." },
  { icon: ThumbsDown, title: "Dislikes are back", text: "Like ratios from Return YouTube Dislike, and honest titles from DeArrow." },
  { icon: ShieldCheck, title: "Nothing to track", text: "Video is proxied through your server. History stays on your device." },
];

export function WelcomePage() {
  const navigate = useNavigate();
  const session = useSession();
  const profile = useProfile();
  const { accounts } = useAccounts();
  useTitle(profile ? "Link a YouTube account" : "Sign in");
  const [auth, setAuth] = useState<AuthConfig | null>(null);
  useEffect(() => {
    void getAuthConfig().then(setAuth);
  }, []);
  if (session.status === "loading") return null;
  // Signed in with accounts already linked: nothing to do here.
  if (profile && accounts.length) return <Navigate to="/" replace />;

  return (
    <div className="relative isolate min-h-dvh overflow-hidden">
      {/* Drifting tiles, drawn locally: nothing third-party loads before sign-in. */}
      <div aria-hidden className="absolute inset-0 -z-10 opacity-40 dark:opacity-30">
        <div className="grid -rotate-6 scale-125 grid-cols-4 gap-4 motion-safe:animate-[drift_60s_linear_infinite] sm:grid-cols-6">
          {Array.from({ length: 36 }, (_, i) => {
            const hue = (i * 47) % 360;
            return (
              <div
                key={i}
                className="aspect-video rounded-xl"
                style={{ background: `linear-gradient(${(i * 33) % 360}deg, oklch(0.55 0.1 ${hue}), oklch(0.3 0.06 ${(hue + 50) % 360}))` }}
              />
            );
          })}
        </div>
      </div>
      <div aria-hidden className="from-background via-background/90 to-background/60 absolute inset-0 -z-10 bg-gradient-to-r" />
      <style>{`@keyframes drift { to { transform: rotate(-6deg) scale(1.25) translateY(-25%); } }`}</style>

      <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <Logo className="[&_span]:text-2xl" />
          <h1 className="font-display mt-10 text-5xl leading-[1.02] font-semibold text-balance sm:text-6xl">
            {brand.tagline.split(". ")[0]}. <span className="text-brand-strong">{brand.tagline.split(". ")[1]}</span>
          </h1>
          <p className="text-muted-foreground mt-6 max-w-lg text-lg">{brand.description}</p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="bg-brand-soft text-brand-strong grid size-9 shrink-0 place-items-center rounded-xl">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <Card className="shadow-float bg-card/90 backdrop-blur-xl">
          {profile ? (
            <>
              <CardHeader>
                <p className="text-brand-strong text-xs font-semibold">Step 2 of 2</p>
                <CardTitle className="font-display text-2xl">Link a YouTube account</CardTitle>
                <CardDescription>
                  Welcome, {profile.name.split(" ")[0]}. Link one or more accounts to your {brand.name} account. You can add more any time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConnectAccount returnTo="home" />
                <Button variant="ghost" className="h-10 w-full rounded-xl" onClick={() => navigate("/")}>
                  Skip for now <ArrowRight />
                </Button>
              </CardContent>
            </>
          ) : auth === null ? (
            <div className="grid place-items-center p-10">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : auth.oidc ? (
            <SsoSignIn name={auth.oidc.name} />
          ) : (
            <SignIn />
          )}
        </Card>
      </div>
    </div>
  );
}

const SSO_ERRORS: Record<string, string> = {
  expired: "That sign-in took too long or was started in another browser. Try again.",
  denied: "Sign-in was cancelled at the provider.",
  provider: "The sign-in provider didn't complete the sign-in. Try again, or ask your administrator.",
  email_taken: "An account with your email already exists, but your provider hasn't verified that email, so it can't be linked.",
};

/** Step 1 with single sign-on: the only way in. */
function SsoSignIn({ name }: { name: string }) {
  const error = new URLSearchParams(location.search).get("sso_error");
  const [leaving, setLeaving] = useState(false);
  return (
    <>
      <CardHeader>
        <p className="text-brand-strong text-xs font-semibold">Step 1 of 2</p>
        <CardTitle className="font-display text-2xl">Sign in to {brand.name}</CardTitle>
        <CardDescription>
          This server uses {name} for sign-in. Your {brand.name} account is created automatically the first time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          size="lg"
          className="h-11 w-full rounded-xl text-base"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            window.location.assign("/api/auth/oidc/start");
          }}
        >
          {leaving ? <Spinner /> : <LogIn />} Continue with {name}
        </Button>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {SSO_ERRORS[error] ?? SSO_ERRORS.provider}
          </p>
        )}
      </CardContent>
    </>
  );
}

/** Step 1: the app account. Passkeys first, password as the fallback. */
function SignIn() {
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "passkey" | "password">(null);
  const [error, setError] = useState<string | null>(null);
  const creating = mode === "create";

  const run = async (kind: "passkey" | "password", task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch (e) {
      const err = e as Error;
      // The browser reports a cancelled passkey prompt as NotAllowedError; that isn't an error worth showing.
      if (err.name !== "NotAllowedError") setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const passkey = () =>
    run("passkey", () =>
      creating ? authActions.passkeyRegister({ name: name.trim(), email: email.trim() }) : authActions.passkeySignIn(),
    );
  const submit = () =>
    run("password", () => (creating ? authActions.register(name.trim(), email.trim(), password) : authActions.signIn(email.trim(), password)));

  const needsProfile = creating && (!name.trim() || !/^\S+@\S+\.\S+$/.test(email));

  return (
    <>
      <CardHeader>
        <p className="text-brand-strong text-xs font-semibold">Step 1 of 2</p>
        <CardTitle className="font-display text-2xl">{creating ? `Create your ${brand.name} account` : `Sign in to ${brand.name}`}</CardTitle>
        <CardDescription>One {brand.name} account holds all your linked YouTube accounts and settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {creating && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Name</Label>
                <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
            </>
          )}
          <Button
            type="button"
            size="lg"
            className="h-11 w-full rounded-xl text-base"
            disabled={busy !== null || needsProfile}
            onClick={() => void passkey()}
          >
            {busy === "passkey" ? <Spinner /> : <Fingerprint />}
            {creating ? "Create with a passkey" : "Sign in with a passkey"}
          </Button>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-muted-foreground text-xs">or with a password</span>
            <Separator className="flex-1" />
          </div>
          {!creating && (
            <div className="space-y-1.5">
              <Label htmlFor="signin-email">Email</Label>
              <Input id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="profile-password">Password</Label>
            <Input
              id="profile-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={creating ? "new-password" : "current-password"}
              minLength={creating ? 10 : undefined}
              aria-describedby={creating ? "password-hint" : undefined}
            />
            {creating && (
              <p id="password-hint" className="text-muted-foreground text-xs">
                At least 10 characters.
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="submit" variant="secondary" className="h-10 w-full rounded-xl" disabled={busy !== null || !email || !password}>
            {busy === "password" && <Spinner />}
            {creating ? "Create account" : "Sign in"}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            {creating ? "Already have an account? " : "New here? "}
            <button
              type="button"
              className="text-foreground font-medium hover:underline"
              onClick={() => {
                setMode(creating ? "signin" : "create");
                setError(null);
              }}
            >
              {creating ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
      </CardContent>
    </>
  );
}
