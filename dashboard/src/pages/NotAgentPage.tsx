import { useState } from "react";
import { bootstrapAdmin, errorMessage, signOut, type User } from "@clayver/core";
import { useClayver } from "../clayver";
import { CenteredCard, ErrorBanner } from "../components/ui";

export function NotAgentPage({ user }: { user: User }) {
  const { client } = useClayver();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  const onClaim = async () => {
    setBusy(true);
    setError(null);
    try {
      await bootstrapAdmin(client);
      // The agents/{uid} subscription switches the app to the inbox once the role lands.
      setClaimed(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredCard title="You are not an agent of this workspace">
      <p>
        You are signed in as <strong>{user.email ?? user.uid}</strong>, but this account has no
        agent role in the <code>{client.projectId}</code> workspace.
      </p>
      <p>Ask an admin to add you from the Team page, then reload.</p>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {claimed && (
        <p className="banner banner--info" role="status">
          You are now the admin. Loading your inbox…
        </p>
      )}
      <details className="details">
        <summary>Setting up Clayver for the first time?</summary>
        <p className="small">
          If this workspace has no admin yet and your verified email is listed in the{" "}
          <code>CLAYVER_BOOTSTRAP_ADMINS</code> function parameter, you can claim the admin role.
        </p>
        <button type="button" className="btn btn--primary" onClick={onClaim} disabled={busy || claimed}>
          {busy ? "Claiming…" : "Claim admin"}
        </button>
      </details>
      <button type="button" className="btn btn--block" onClick={() => void signOut(client)}>
        Sign out
      </button>
    </CenteredCard>
  );
}
