import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { signOut } from "@clayver/core";
import { useAuth } from "./auth";
import { useClient } from "./clayver";
import { Layout } from "./components/Layout";
import { CenteredCard, ErrorBanner, FullPageSpinner } from "./components/ui";
import { SignInPage } from "./pages/SignInPage";
import { NotAgentPage } from "./pages/NotAgentPage";
import { InboxPage, NoConversationSelected } from "./pages/InboxPage";
import { ConversationPage } from "./pages/ConversationPage";
import { TeamPage } from "./pages/TeamPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  const auth = useAuth();
  const client = useClient();

  if (auth.status === "loading") return <FullPageSpinner label="Checking your session" />;
  // Sign-in renders in place so deep links survive the login.
  if (auth.status === "signed-out") return <SignInPage />;
  if (auth.roleLoading) return <FullPageSpinner label="Loading your role" />;
  if (auth.roleError) {
    return (
      <CenteredCard title="Could not load your role">
        <ErrorBanner error={auth.roleError} onRetry={() => window.location.reload()} />
        <p className="small muted">
          Check that the Clayver database rules are deployed and that{" "}
          the workspace (<code>projectId</code> in <code>clayver.config.json</code>) is the one you were added to.
        </p>
        <button type="button" className="btn btn--block" onClick={() => void signOut(client)}>
          Sign out
        </button>
      </CenteredCard>
    );
  }
  if (!auth.role) return <NotAgentPage user={auth.user} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/conversations" replace />} />
        <Route path="conversations" element={<InboxPage />}>
          <Route index element={<NoConversationSelected />} />
          <Route path=":conversationId" element={<ConversationPage />} />
        </Route>
        <Route
          path="team"
          element={
            <RequireAdmin>
              <TeamPage />
            </RequireAdmin>
          }
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status !== "signed-in" || auth.role !== "admin") {
    return (
      <div className="page">
        <h1>Admins only</h1>
        <p>Only workspace admins can manage the team.</p>
      </div>
    );
  }
  return <>{children}</>;
}
