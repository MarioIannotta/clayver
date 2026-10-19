import type { ReactNode } from "react";
import { initials } from "../lib/format";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span className="spinner__circle" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="full-page-center">
      <Spinner label={label} />
    </div>
  );
}

export function ErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: { message: string } | string | null | undefined;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error.message;
  return (
    <div className="banner banner--error" role="alert">
      <span>{message}</span>
      <span className="banner__actions">
        {onRetry && (
          <button type="button" className="btn btn--small" onClick={onRetry}>
            Retry
          </button>
        )}
        {onDismiss && (
          <button type="button" className="btn btn--small btn--ghost" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        )}
      </span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__body">{children}</div>}
    </div>
  );
}

export function Avatar({ label, size = 32 }: { label: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials(label)}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function CenteredCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="full-page-center">
      <section className="card card--narrow" aria-labelledby="card-title">
        <div className="brand brand--large">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} />
          <span>Clayver</span>
        </div>
        <h1 id="card-title" className="card__title">
          {title}
        </h1>
        {children}
      </section>
    </main>
  );
}
