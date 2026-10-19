import { useEffect, useId, useState, type FormEvent } from "react";
import {
  DEFAULT_RATE_LIMITS,
  effectiveRateLimits,
  errorMessage,
  MAX_RATE_LIMIT,
  MIN_RATE_LIMIT,
  setRateLimits,
} from "@clayver/core";
import { useClient } from "../clayver";
import { usePrivateConfig } from "../lib/hooks";
import { ErrorBanner, Spinner } from "./ui";

/** Admin-only: the automatic rate limits in `config/private/rateLimits`. */
export function RateLimitSettings() {
  const client = useClient();
  const config = usePrivateConfig();
  const current = effectiveRateLimits(config.data);
  const [messages, setMessages] = useState(String(current.messagesPerMinute));
  const [conversations, setConversations] = useState(String(current.conversationsPerHour));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const messagesId = useId();
  const conversationsId = useId();

  // Show stored values once they load (and when another admin changes them).
  useEffect(() => {
    setMessages(String(current.messagesPerMinute));
    setConversations(String(current.conversationsPerHour));
  }, [current.messagesPerMinute, current.conversationsPerHour]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setRateLimits(client, {
        messagesPerMinute: Number(messages),
        conversationsPerHour: Number(conversations),
      });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const usingDefaults = !config.data.rateLimits;

  return (
    <section className="card" aria-labelledby="rate-limits-title" id="rate-limits">
      <h2 id="rate-limits-title">Rate limits</h2>
      <p className="muted small">
        A customer who goes over a limit is blocked automatically (10 minutes for messages, 1 hour for conversations).
        The block shows in the conversation&apos;s customer panel, where an agent can lift it.
      </p>
      <ErrorBanner error={error ?? config.error} onDismiss={error ? () => setError(null) : undefined} />
      {config.loading ? (
        <Spinner label="Loading rate limits" />
      ) : (
        <form className="rate-limits-form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor={messagesId} className="field__label">
              Messages per minute
            </label>
            <input
              id={messagesId}
              type="number"
              inputMode="numeric"
              min={MIN_RATE_LIMIT}
              max={MAX_RATE_LIMIT}
              step={1}
              required
              value={messages}
              onChange={(e) => {
                setMessages(e.target.value);
                setSaved(false);
              }}
            />
            <span className="muted small">Default {DEFAULT_RATE_LIMITS.messagesPerMinute}</span>
          </div>
          <div className="field">
            <label htmlFor={conversationsId} className="field__label">
              Conversations per hour
            </label>
            <input
              id={conversationsId}
              type="number"
              inputMode="numeric"
              min={MIN_RATE_LIMIT}
              max={MAX_RATE_LIMIT}
              step={1}
              required
              value={conversations}
              onChange={(e) => {
                setConversations(e.target.value);
                setSaved(false);
              }}
            />
            <span className="muted small">Default {DEFAULT_RATE_LIMITS.conversationsPerHour}</span>
          </div>
          <div className="rate-limits-form__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Saving…" : "Save limits"}
            </button>
            {saved && <span className="small success-text">Saved</span>}
            {usingDefaults && !saved && <span className="small muted">Using the defaults</span>}
          </div>
        </form>
      )}
    </section>
  );
}
