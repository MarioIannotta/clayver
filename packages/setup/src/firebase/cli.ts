import { ClayverError } from "../core/errors.js";
import { parseFirebaseJson, type CommandResult, type Runner } from "../core/runner.js";

export interface FirebaseProject {
  projectId: string;
  displayName?: string;
}

export interface FirebaseApp {
  appId: string;
  displayName?: string;
  platform: string;
  /** Bundle id (iOS) or package name (Android). */
  namespace?: string;
}

export interface DatabaseInstance {
  name: string;
  databaseUrl?: string;
  type?: string;
  location?: string;
}

export interface DeployedFunction {
  id: string;
  region?: string;
  codebase?: string;
}

/** Thin, typed wrapper over the Firebase CLI. Every call goes through the runner. */
export class FirebaseCli {
  constructor(
    private readonly runner: Runner,
    private readonly bin = "firebase",
  ) {}

  private run(args: string[], opts: { mutating: boolean; cwd?: string; input?: string; interactive?: boolean }) {
    return this.runner.run({ command: this.bin, args, ...opts });
  }

  async version(): Promise<string | undefined> {
    const r = await this.run(["--version"], { mutating: false });
    return r.exitCode === 0 ? r.stdout.trim().split("\n").pop() : undefined;
  }

  /**
   * The signed-in account. Parses the human output of `login:list` on purpose:
   * its `--json` output contains OAuth tokens, which Clayver never wants to hold.
   */
  async loggedInAccount(): Promise<string | undefined> {
    const r = await this.run(["login:list"], { mutating: false });
    if (r.exitCode !== 0) return undefined;
    return /Logged in as (\S+)/.exec(r.stdout + r.stderr)?.[1];
  }

  async listProjects(): Promise<FirebaseProject[]> {
    const r = await this.run(["projects:list", "--json"], { mutating: false });
    const result = parseFirebaseJson<FirebaseProject[]>(r.stdout);
    if (r.exitCode !== 0 || !result) {
      throw new ClayverError(
        "Could not list your Firebase projects.",
        `Make sure you are signed in (\`firebase login\`). Firebase CLI said: ${firstLine(r.stderr || r.stdout)}`,
      );
    }
    return result.map((p) => ({ projectId: p.projectId, displayName: p.displayName }));
  }

  async createProject(projectId: string, displayName: string): Promise<CommandResult> {
    return this.run(["projects:create", projectId, "--display-name", displayName], { mutating: true, interactive: true });
  }

  async listApps(platform: "IOS" | "ANDROID" | "WEB", project: string): Promise<FirebaseApp[] | undefined> {
    const r = await this.run(["apps:list", platform, "--project", project, "--json"], { mutating: false });
    return r.exitCode === 0 ? (parseFirebaseJson<FirebaseApp[]>(r.stdout) ?? []) : undefined;
  }

  async createApp(
    platform: "IOS" | "ANDROID" | "WEB",
    displayName: string,
    identifier: string | undefined,
    project: string,
  ): Promise<{ appId?: string; result: CommandResult }> {
    const args = ["apps:create", platform, displayName, "--project", project, "--json"];
    if (platform === "IOS" && identifier) args.push("--bundle-id", identifier);
    if (platform === "ANDROID" && identifier) args.push("--package-name", identifier);
    const result = await this.run(args, { mutating: true });
    return { appId: parseFirebaseJson<{ appId?: string }>(result.stdout)?.appId, result };
  }

  async sdkConfig(
    platform: "IOS" | "ANDROID" | "WEB",
    appId: string,
    project: string,
  ): Promise<{ fileName: string; fileContents: string } | undefined> {
    const r = await this.run(["apps:sdkconfig", platform, appId, "--project", project, "--json"], { mutating: false });
    if (r.exitCode !== 0) return undefined;
    return parseFirebaseJson<{ fileName: string; fileContents: string }>(r.stdout);
  }

  /** The raw `result` of `apps:sdkconfig WEB <appId> --json` (see parseWebSdkConfig). */
  async webSdkConfig(appId: string, project: string): Promise<unknown> {
    const r = await this.run(["apps:sdkconfig", "WEB", appId, "--project", project, "--json"], { mutating: false });
    if (r.exitCode !== 0) return undefined;
    return parseFirebaseJson<unknown>(r.stdout);
  }

  async listDatabaseInstances(project: string): Promise<DatabaseInstance[] | undefined> {
    const r = await this.run(["database:instances:list", "--project", project, "--json"], { mutating: false });
    if (r.exitCode !== 0) return undefined;
    return parseFirebaseJson<DatabaseInstance[]>(r.stdout) ?? [];
  }

  /** `force` also sets up the Artifact Registry cleanup policy, which `--non-interactive` alone refuses to. */
  deploy(only: string[], project: string, cwd: string, nonInteractive: boolean, force = false): Promise<CommandResult> {
    const args = ["deploy", "--only", only.join(","), "--project", project];
    if (nonInteractive) args.push("--non-interactive");
    if (force) args.push("--force");
    return this.run(args, { mutating: true, cwd, interactive: true });
  }

  async listFunctions(project: string): Promise<DeployedFunction[] | undefined> {
    const r = await this.run(["functions:list", "--project", project, "--json"], { mutating: false });
    if (r.exitCode !== 0) return undefined;
    return parseFirebaseJson<DeployedFunction[]>(r.stdout) ?? [];
  }

  /** Deletes every function of a codebase (`firebase functions:delete <codebase>`). */
  deleteCodebase(codebase: string, project: string): Promise<CommandResult> {
    return this.run(["functions:delete", codebase, "--project", project, "--force"], { mutating: true, interactive: true });
  }

  databaseRemove(path: string, project: string): Promise<CommandResult> {
    return this.run(["database:remove", path, "--project", project, "--force"], { mutating: true, interactive: true });
  }
}

export function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("{")) ?? "(no output)"
  );
}
