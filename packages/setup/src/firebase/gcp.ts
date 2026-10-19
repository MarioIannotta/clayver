import type { Runner } from "../core/runner.js";

/**
 * Optional checks and automation through Google Cloud REST APIs. They only run
 * when `gcloud` is installed and signed in; otherwise Clayver prints console
 * links instead. Nothing here is required for setup to succeed.
 */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface GcpDeps {
  runner: Runner;
  fetch: FetchLike;
}

export async function gcloudAccessToken(runner: Runner): Promise<string | undefined> {
  if (!(await runner.which("gcloud"))) return undefined;
  const r = await runner.run({ command: "gcloud", args: ["auth", "print-access-token", "--quiet"], mutating: false });
  const token = r.stdout.trim();
  return r.exitCode === 0 && token && !token.includes(" ") ? token : undefined;
}

function headers(token: string, project: string) {
  return { Authorization: `Bearer ${token}`, "x-goog-user-project": project, "Content-Type": "application/json" };
}

export async function billingEnabled(deps: GcpDeps, project: string, token: string): Promise<boolean | undefined> {
  try {
    const res = await deps.fetch(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`, {
      headers: headers(token, project),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { billingEnabled?: boolean };
    return body.billingEnabled === true;
  } catch {
    return undefined;
  }
}

export interface AuthProviders {
  anonymous: boolean;
  emailPassword: boolean;
  google?: boolean;
}

const IDT = "https://identitytoolkit.googleapis.com/admin/v2";

export async function getAuthProviders(deps: GcpDeps, project: string, token: string): Promise<AuthProviders | undefined> {
  try {
    const res = await deps.fetch(`${IDT}/projects/${project}/config`, { headers: headers(token, project) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { signIn?: { anonymous?: { enabled?: boolean }; email?: { enabled?: boolean } } };
    let google: boolean | undefined;
    const g = await deps.fetch(`${IDT}/projects/${project}/defaultSupportedIdpConfigs/google.com`, {
      headers: headers(token, project),
    });
    if (g.ok) google = ((await g.json()) as { enabled?: boolean }).enabled === true;
    else if (g.status === 404) google = false;
    return {
      anonymous: body.signIn?.anonymous?.enabled === true,
      emailPassword: body.signIn?.email?.enabled === true,
      google,
    };
  } catch {
    return undefined;
  }
}

/** Enables Anonymous and Email/Password sign-in. Google needs an OAuth client and stays a console step. */
export async function enableAuthProviders(deps: GcpDeps, project: string, token: string): Promise<boolean> {
  try {
    const mask = "signIn.anonymous.enabled,signIn.email.enabled,signIn.email.passwordRequired";
    const res = await deps.fetch(`${IDT}/projects/${project}/config?updateMask=${encodeURIComponent(mask)}`, {
      method: "PATCH",
      headers: headers(token, project),
      body: JSON.stringify({ signIn: { anonymous: { enabled: true }, email: { enabled: true, passwordRequired: true } } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
