import { useState, type FormEvent } from "react";
import { errorMessage, sendPasswordReset, signInWithEmail, signInWithGoogle, toClayverError } from "@clayver/core";
import { useClayver } from "../clayver";
import { CenteredCard, ErrorBanner } from "../components/ui";

export function SignInPage() {
  const { client, config } = useClayver();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"email" | "google" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("email");
    setError(null);
    setNotice(null);
    try {
      await signInWithEmail(client, email, password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const onGoogle = async () => {
    setBusy("google");
    setError(null);
    setNotice(null);
    try {
      await signInWithGoogle(client);
    } catch (err) {
      const mapped = toClayverError(err);
      if (mapped.code !== "cancelled") setError(mapped.message);
      setBusy(null);
    }
  };

  const onReset = async () => {
    if (!email.trim()) {
      setError("Enter your email address first, then choose “Forgot password”.");
      return;
    }
    setBusy("reset");
    setError(null);
    try {
      await sendPasswordReset(client, email);
      setNotice(`If ${email.trim()} has an account, a password reset email is on its way.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <CenteredCard title="Sign in to your support inbox">
      {config.useEmulators && (
        <p className="banner banner--info">Connected to the Firebase emulators.</p>
      )}
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {notice && (
        <p className="banner banner--info" role="status">
          {notice}
        </p>
      )}
      <form className="stack" onSubmit={onSubmit} noValidate={false}>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--primary btn--block" disabled={busy !== null}>
          {busy === "email" ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" className="btn btn--link" onClick={onReset} disabled={busy !== null}>
          Forgot password?
        </button>
      </form>
      <div className="divider" role="separator">
        <span>or</span>
      </div>
      <button type="button" className="btn btn--block" onClick={onGoogle} disabled={busy !== null}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>
      <p className="muted small">
        Only team members added by an admin can use this dashboard.
      </p>
    </CenteredCard>
  );
}
