import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { Layout } from "@/components/shell/layout";
import { PlayerBoundary } from "@/components/player/player-boundary";
import { ChannelPage } from "@/pages/channel";
import { HomePage } from "@/pages/home";
import { LibraryPage } from "@/pages/library";
import { SearchPage } from "@/pages/search";
import { SettingsPage } from "@/pages/settings";
import { AnalyticsPage } from "@/pages/analytics";
import { CalendarPage } from "@/pages/calendar";
import { SubscriptionsPage } from "@/pages/subscriptions";
import { WelcomePage } from "@/pages/welcome";
import { useSession } from "@/lib/session";

// DASH and subtitle decoders are only needed when opening a watch page.
const WatchPage = lazy(() => import("@/pages/watch").then((module) => ({ default: module.WatchPage })));

/** The app needs a signed-in profile; linked accounts are optional (the feed explains how to add one). */
function RequireProfile({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.status === "loading") return null;
  if (session.status === "error")
    return (
      <div className="text-muted-foreground grid min-h-dvh place-items-center p-6 text-center text-sm">
        Can't reach the server. Check that it's running, then reload.
      </div>
    );
  return session.status === "ready" ? children : <Navigate to="/welcome" replace />;
}

/** Links from before items named their backend (/watch/<id>, /channel/<id>) are YouTube ones. */
function Legacy({ to }: { to: "watch" | "channel" }) {
  const { id = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/${to}/youtube/${id}${search}`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        element={
          <RequireProfile>
            <Layout />
          </RequireProfile>
        }
      >
        <Route index element={<HomePage />} />
        <Route
          path="/watch/:backend/:id"
          element={
            <PlayerBoundary>
              <Suspense fallback={<div role="status" className="page text-muted-foreground">Loading player…</div>}>
                <WatchPage />
              </Suspense>
            </PlayerBoundary>
          }
        />
        <Route path="/watch/:id" element={<Legacy to="watch" />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/channel/:backend/:id" element={<ChannelPage />} />
        <Route path="/channel/:id" element={<Legacy to="channel" />} />
        <Route path="/following" element={<SubscriptionsPage />} />
        <Route path="/subscriptions" element={<Navigate to="/following" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
