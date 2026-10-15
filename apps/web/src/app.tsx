import { Navigate, Route, Routes } from "react-router";
import { Layout } from "@/components/shell/layout";
import { ChannelPage } from "@/pages/channel";
import { HomePage } from "@/pages/home";
import { LibraryPage } from "@/pages/library";
import { SearchPage } from "@/pages/search";
import { SettingsPage } from "@/pages/settings";
import { SubscriptionsPage } from "@/pages/subscriptions";
import { WatchPage } from "@/pages/watch";
import { WelcomePage } from "@/pages/welcome";
import { useSession } from "@/lib/session";

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
        <Route path="/watch/:id" element={<WatchPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/channel/:id" element={<ChannelPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
