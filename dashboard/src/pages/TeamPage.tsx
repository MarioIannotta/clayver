import { useId, useState, type FormEvent } from "react";
import {
  errorMessage,
  isValidEmail,
  revokeAgent,
  setAgentRole,
  type Agent,
  type AgentRole,
  type SetAgentRoleResponse,
} from "@clayver/core";
import { useClient } from "../clayver";
import { useAgent } from "../auth";
import { useAgents } from "../lib/hooks";
import { formatFull } from "../lib/format";
import { Avatar, Badge, EmptyState, ErrorBanner, Spinner } from "../components/ui";
import { Select, type SelectOption } from "../components/Select";

const ROLE_OPTIONS: SelectOption<AgentRole>[] = [
  { value: "agent", label: "Agent", description: "Reads and answers every conversation" },
  { value: "admin", label: "Admin", description: "Also manages the team and settings" },
];

export function TeamPage() {
  const agents = useAgents();
  const active = agents.data.filter((a) => a.active);
  const revoked = agents.data.filter((a) => !a.active);

  return (
    <div className="page">
      <h1>Team</h1>
      <p className="muted">
        Agents can read and answer every conversation in this workspace. Admins can also manage the team.
      </p>
      <InviteForm />
      <section aria-labelledby="members-title" className="card">
        <h2 id="members-title">Members</h2>
        <p className="muted small">
          People with a Firebase Auth account in this project. The same account works in this dashboard and in the
          agent inbox inside your app.
        </p>
        <ErrorBanner error={agents.error} />
        {agents.loading ? (
          <Spinner label="Loading team" />
        ) : active.length === 0 ? (
          <EmptyState title="No active agents" />
        ) : (
          <AgentTable agents={active} />
        )}
        {revoked.length > 0 && (
          <details className="details">
            <summary>Revoked ({revoked.length})</summary>
            <AgentTable agents={revoked} />
          </details>
        )}
      </section>
    </div>
  );
}

function InviteForm() {
  const client = useClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AgentRole>("agent");
  const roleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(SetAgentRoleResponse & { email: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await setAgentRole(client, { email, role, displayName: displayName || undefined });
      setResult({ ...res, email: email.trim() });
      setEmail("");
      setDisplayName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result?.inviteLink) return;
    try {
      await navigator.clipboard.writeText(result.inviteLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="invite-title" className="card">
      <h2 id="invite-title">Add a team member</h2>
      <form className="invite-form" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          <span className="field__label">Display name (optional)</span>
          <input type="text" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <div className="field">
          <label className="field__label" htmlFor={roleId}>
            Role
          </label>
          <Select<AgentRole>
            id={roleId}
            value={role}
            onChange={setRole}
            options={ROLE_OPTIONS}
          />
        </div>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {result && (
        <div className="banner banner--info" role="status">
          <div className="stack">
            <span>
              <strong>{result.email}</strong> is now {result.role === "admin" ? "an admin" : "an agent"}.
            </span>
            {result.inviteLink ? (
              <>
                <span>
                  This email had no account yet. Send them this link to set a password, then they can sign in:
                </span>
                <div className="invite-link">
                  <input type="text" readOnly value={result.inviteLink} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="btn btn--small" onClick={copy}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            ) : (
              <span>They can sign in with their existing account.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function AgentTable({ agents }: { agents: Agent[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Role</th>
            <th scope="col">Added</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <AgentRow key={a.uid} agent={a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const client = useClient();
  const { user } = useAgent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMe = agent.uid === user.uid;
  const label = agent.displayName || agent.email || agent.uid;

  const change = async (role: AgentRole | "none") => {
    if (role === "none" && !window.confirm(`Revoke access for ${label}? They are signed out on every device, including your app.`)) return;
    setBusy(true);
    setError(null);
    try {
      if (role === "none") await revokeAgent(client, agent.uid);
      else await setAgentRole(client, { uid: agent.uid, role });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>
        <div className="member">
          <Avatar label={label} size={28} />
          <div>
            <div>
              {agent.displayName || agent.email || agent.uid} {isMe && <Badge>you</Badge>}
            </div>
            {agent.displayName && agent.email && <div className="muted small">{agent.email}</div>}
            {error && (
              <div className="error-text small" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
      </td>
      <td>
        {agent.active ? (
          <span title={isMe ? "You cannot change your own role" : undefined}>
            <Select<AgentRole>
              size="small"
              label={`Role of ${label}`}
              value={agent.role}
              disabled={busy || isMe}
              onChange={(r) => void change(r)}
              options={ROLE_OPTIONS}
            />
          </span>
        ) : (
          <Badge>revoked</Badge>
        )}
      </td>
      <td className="small muted">{formatFull(agent.createdAt)}</td>
      <td className="table__actions">
        {agent.active ? (
          <button type="button" className="btn btn--small btn--danger" disabled={busy || isMe} onClick={() => void change("none")}>
            Revoke
          </button>
        ) : (
          <button type="button" className="btn btn--small" disabled={busy} onClick={() => void change(agent.role)}>
            Restore
          </button>
        )}
      </td>
    </tr>
  );
}
