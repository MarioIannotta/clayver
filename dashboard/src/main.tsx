import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { createClayverClient } from "@clayver/core";
import { loadConfig, type DashboardConfig } from "./config";
import { FullPageSpinner } from "./components/ui";
import { ClayverProvider } from "./clayver";
import { AuthProvider } from "./auth";
import { App } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

function NotConfigured({ config }: { config: DashboardConfig }) {
  return (
    <main className="full-page-center">
      <section className="card card--narrow" aria-labelledby="config-title">
        <h1 id="config-title" className="card__title">
          Dashboard not configured
        </h1>
        <p>The dashboard could not start because its configuration is incomplete:</p>
        <ul>
          {config.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="small muted">
          Run <code>npx clayver init</code> in your app to generate <code>clayver-dashboard/clayver.config.json</code>,
          then start the dashboard with <code>npm start</code> in that folder. For local development of the dashboard
          itself, set the <code>VITE_*</code> variables in <code>dashboard/.env.local</code> (see{" "}
          <code>.env.example</code>).
        </p>
      </section>
    </main>
  );
}

function start(config: DashboardConfig) {
  if (config.problems.length > 0) {
    root.render(
      <StrictMode>
        <NotConfigured config={config} />
      </StrictMode>,
    );
    return;
  }
  const client = createClayverClient({
    firebaseConfig: config.firebase,
    projectId: config.projectId,
    functionsRegion: config.functionsRegion,
    emulators: config.useEmulators ? { host: config.emulatorHost } : false,
    // Initialised before Auth, Database, Storage and Functions when configured.
    appCheck: config.appCheck,
  });

  root.render(
    <StrictMode>
      <ClayverProvider client={client} config={config}>
        <AuthProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || "/"}>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ClayverProvider>
    </StrictMode>,
  );
}

root.render(
  <StrictMode>
    <FullPageSpinner label="Loading configuration" />
  </StrictMode>,
);

loadConfig()
  .then(start)
  .catch((err: unknown) =>
    start({
      firebase: {},
      projectId: "default",
      functionsRegion: "us-central1",
      vapidKey: "",
      useEmulators: false,
      emulatorHost: "127.0.0.1",
      appCheck: null,
      source: "none",
      problems: [`Loading the configuration failed: ${err instanceof Error ? err.message : String(err)}`],
    }),
  );
