import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { signOut, unregisterAgentWebPush } from "@clayver/core";
import { useClayver } from "../clayver";
import { useAgent } from "../auth";
import { useAgentSettings } from "../lib/hooks";
import { enableWebPush, getPushSupport, onForegroundPush, type ForegroundPush } from "../lib/push";
import { Avatar, Badge } from "./ui";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Layout() {
  const { client, config } = useClayver();
  const { user, role, displayName } = useAgent();
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useAgentSettings(user.uid);
  const [toast, setToast] = useState<ForegroundPush | null>(null);
  const pushEnabled = settings.data.notifications?.push === true;

  // Foreground pushes arrive from the service worker as messages.
  useEffect(
    () =>
      onForegroundPush((push) => {
        if (location.pathname.endsWith(`/conversations/${push.data.conversationId}`)) return;
        setToast(push);
      }),
    [location.pathname],
  );

  // Notification clicks route through the page's router.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type?: string; url?: string } | null;
      if (msg?.type === "clayver-navigate" && typeof msg.url === "string") {
        navigate(msg.url.startsWith(BASE) ? msg.url.slice(BASE.length) || "/" : msg.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [navigate]);

  // Refresh this browser's push registration on load (tokens rotate).
  useEffect(() => {
    if (!pushEnabled || !config.vapidKey) return;
    let cancelled = false;
    void (async () => {
      const support = await getPushSupport();
      if (cancelled || !support.supported || support.permission !== "granted") return;
      await enableWebPush(client, config.vapidKey).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, config.vapidKey, pushEnabled, user.uid]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const onSignOut = async () => {
    if (pushEnabled) await unregisterAgentWebPush(client).catch(() => undefined);
    await signOut(client);
    navigate("/conversations");
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/conversations" className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={24} height={24} />
          <span>Clayver</span>
        </Link>
        <nav aria-label="Main" className="topbar__nav">
          <NavLink to="/conversations">Inbox</NavLink>
          {role === "admin" && <NavLink to="/team">Team</NavLink>}
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="topbar__user">
          {config.useEmulators && <Badge tone="warning">Emulators</Badge>}
          <Badge tone={role === "admin" ? "accent" : "neutral"}>{role}</Badge>
          <Avatar label={displayName} size={28} />
          <span className="topbar__name" title={user.email ?? undefined}>
            {displayName}
          </span>
          <button type="button" className="btn btn--small btn--ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main id="main" className="app__main" tabIndex={-1}>
        <Outlet />
      </main>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <div>
            <strong>{toast.title ?? "New message"}</strong>
            {toast.body && <p>{toast.body}</p>}
          </div>
          <div className="toast__actions">
            <Link
              className="btn btn--small btn--primary"
              to={`/conversations/${encodeURIComponent(toast.data.conversationId)}`}
              onClick={() => setToast(null)}
            >
              Open
            </Link>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setToast(null)} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
