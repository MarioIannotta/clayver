import { useEffect, useId, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { errorMessage, setAgentPushEnabled, setMyDisplayName } from "@clayver/core";
import { useClayver } from "../clayver";
import { useAgent } from "../auth";
import { useAgentSettings } from "../lib/hooks";
import { disableWebPush, enableWebPush, getPushSupport, type PushSupport } from "../lib/push";
import { ErrorBanner, Spinner } from "../components/ui";
import { TagSettings } from "../components/TagSettings";
import { TriageSettings } from "../components/TriageSettings";
import { SavedReplySettings } from "../components/SavedReplySettings";
import { RateLimitSettings } from "../components/RateLimitSettings";
import { SignInSettings } from "../components/SignInSettings";

export function SettingsPage() {
  const { client, config } = useClayver();
  const { user, role, displayName } = useAgent();
  const settings = useAgentSettings(user.uid);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleId = useId();
  const enabled = settings.data.notifications?.push === true;
  const { hash } = useLocation();

  // Links such as /settings#saved-replies scroll to their section.
  useEffect(() => {
    if (!hash) return;
    const id = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(id);
  }, [hash]);

  useEffect(() => {
    void getPushSupport().then(setSupport);
  }, []);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (next) {
        await enableWebPush(client, config.vapidKey);
        await setAgentPushEnabled(client, true);
      } else {
        await setAgentPushEnabled(client, false);
        await disableWebPush(client);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      void getPushSupport().then(setSupport);
    }
  };

  const unavailableReason = !config.vapidKey
    ? "Web push is not configured for this dashboard (add a vapidKey to clayver.config.json)."
    : support && !support.supported
      ? "This browser does not support web push notifications."
      : support?.permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again."
        : null;

  return (
    <div className="page">
      <h1>Settings</h1>

      <section className="card" aria-labelledby="profile-title">
        <h2 id="profile-title">Profile</h2>
        <DisplayNameForm current={displayName} />
        <dl className="kv">
          <dt>Email</dt>
          <dd>{user.email ?? "None"}</dd>
          <dt>Role</dt>
          <dd>{role === "admin" ? "Admin" : "Agent"}</dd>
          <dt>Workspace</dt>
          <dd>
            <code>{client.projectId}</code>
          </dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="notifications-title">
        <h2 id="notifications-title">Notifications</h2>
        <ErrorBanner error={error ?? settings.error} onDismiss={error ? () => setError(null) : undefined} />
        {settings.loading || !support ? (
          <Spinner label="Loading settings" />
        ) : (
          <>
            <div className="toggle-row">
              <div>
                <label htmlFor={toggleId} className="toggle-row__label">
                  Browser notifications
                </label>
                <p className="muted small" id={`${toggleId}-desc`}>
                  Get a notification on this browser when a customer writes, even when the dashboard is closed.
                  Clicking it opens the conversation.
                </p>
              </div>
              <input
                id={toggleId}
                type="checkbox"
                role="switch"
                className="switch"
                aria-describedby={`${toggleId}-desc`}
                checked={enabled}
                disabled={busy || (!enabled && !!unavailableReason)}
                onChange={(e) => void toggle(e.target.checked)}
              />
            </div>
            {unavailableReason && <p className="banner banner--warning">{unavailableReason}</p>}
            {enabled && support.permission !== "granted" && !unavailableReason && (
              <p className="banner banner--warning">
                Notifications are on for your account, but this browser has not granted permission yet.{" "}
                <button type="button" className="btn btn--small" onClick={() => void toggle(true)} disabled={busy}>
                  Enable on this browser
                </button>
              </p>
            )}
          </>
        )}
      </section>

      <TriageSettings />
      <TagSettings />
      <SavedReplySettings />
      {role === "admin" && <SignInSettings />}
      {role === "admin" && <RateLimitSettings />}
    </div>
  );
}

function DisplayNameForm({ current }: { current: string }) {
  const { client } = useClayver();
  const inputId = useId();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setName(current), [current]);
  const changed = name.trim() !== current && name.trim().length > 0;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setMyDisplayName(client, name);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="display-name-form" onSubmit={(e) => void save(e)}>
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Display name
        </label>
        <div className="display-name-form__row">
          <input
            id={inputId}
            type="text"
            maxLength={80}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            aria-describedby={`${inputId}-hint`}
          />
          <button type="submit" className="btn btn--primary" disabled={busy || !changed}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        <p id={`${inputId}-hint`} className="muted small">
          {saved ? "Saved. New replies use this name." : "Customers see this name on your replies."}
        </p>
      </div>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
    </form>
  );
}
