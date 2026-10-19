import { useEffect, useId, useState } from "react";
import { anonymousSignIn, errorMessage } from "@clayver/core";
import { useClient } from "../clayver";
import { ErrorBanner, Spinner } from "./ui";

/** Admin-only: whether visitors can chat without an account (Firebase Auth anonymous sign-in). */
export function SignInSettings() {
  const client = useClient();
  const toggleId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    anonymousSignIn(client).then(
      (v) => !cancelled && setEnabled(v),
      (err) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setEnabled(await anonymousSignIn(client, next));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="sign-in-title" id="sign-in">
      <h2 id="sign-in-title">Sign-in</h2>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {enabled === null && !error ? (
        <Spinner label="Loading sign-in settings" />
      ) : enabled !== null ? (
        <div className="toggle-row">
          <div>
            <label htmlFor={toggleId} className="toggle-row__label">
              Anonymous visitors
            </label>
            <p className="muted small" id={`${toggleId}-desc`}>
              Let people who are not signed in to your app contact support. When this is off, your app must sign users
              in before they can chat. This is a Firebase Authentication setting, so it applies to your whole Firebase
              project.
            </p>
          </div>
          <input
            id={toggleId}
            type="checkbox"
            role="switch"
            className="switch"
            aria-describedby={`${toggleId}-desc`}
            checked={enabled}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
        </div>
      ) : null}
    </section>
  );
}
