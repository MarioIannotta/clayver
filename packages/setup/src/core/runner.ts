import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { Logger } from "./logger.js";

/**
 * Every external command Clayver runs (firebase, flutter, pod, npm, gcloud ...)
 * goes through a {@link Runner}. Dry-run and tests swap the implementation, so
 * a mutating command can never slip past them.
 */
export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  /** Written to the child's stdin (used for secrets so they never appear in argv). */
  input?: string;
  /** True when the command changes anything (deploy, create, set, delete, install). */
  mutating: boolean;
  /** Attach the child to the terminal (stdout/stderr inherited, not captured). */
  interactive?: boolean;
  /** Indices of args to print as `***`. */
  redactArgs?: number[];
  env?: Record<string, string>;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Set when dry-run skipped the command. */
  skipped?: boolean;
}

export interface Runner {
  run(spec: CommandSpec): Promise<CommandResult>;
  /** Whether an executable is on PATH. Never runs anything. */
  which(command: string): Promise<boolean>;
}

function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function formatCommand(spec: Pick<CommandSpec, "command" | "args" | "redactArgs" | "input">): string {
  const args = spec.args.map((a, i) => (spec.redactArgs?.includes(i) ? "***" : quote(a)));
  const stdin = spec.input !== undefined ? " (secret value via stdin)" : "";
  return `${[spec.command, ...args].join(" ")}${stdin}`;
}

export class ProcessRunner implements Runner {
  constructor(private readonly logger?: Logger, private readonly verbose = false) {}

  run(spec: CommandSpec): Promise<CommandResult> {
    if (this.verbose) this.logger?.detail(`$ ${formatCommand(spec)}`);
    return new Promise((resolve) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        shell: process.platform === "win32",
        stdio: [
          spec.input !== undefined ? "pipe" : spec.interactive ? "inherit" : "ignore",
          spec.interactive ? "inherit" : "pipe",
          spec.interactive ? "inherit" : "pipe",
        ],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      if (spec.input !== undefined) {
        child.stdin?.end(spec.input);
      }
      child.on("error", (err) => resolve({ exitCode: 127, stdout, stderr: stderr + String(err.message) }));
      child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    });
  }

  async which(command: string): Promise<boolean> {
    const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      if (!dir) continue;
      for (const ext of exts) {
        try {
          accessSync(join(dir, command + ext), constants.X_OK);
          return true;
        } catch {
          // keep looking
        }
      }
    }
    return false;
  }
}

/**
 * Dry-run wrapper: read-only commands (listing projects, checking login) still
 * run so the plan is accurate; mutating commands are only printed.
 */
export class DryRunRunner implements Runner {
  readonly skipped: CommandSpec[] = [];
  constructor(
    private readonly inner: Runner,
    private readonly logger: Logger,
  ) {}
  async run(spec: CommandSpec): Promise<CommandResult> {
    if (spec.mutating) {
      this.skipped.push(spec);
      this.logger.dryRun(`would run: ${formatCommand(spec)}${spec.cwd ? `  (in ${spec.cwd})` : ""}`);
      return { exitCode: 0, stdout: "", stderr: "", skipped: true };
    }
    return this.inner.run(spec);
  }
  which(command: string) {
    return this.inner.which(command);
  }
}

/** Parses the `--json` envelope the Firebase CLI prints: `{ status, result }`. */
export function parseFirebaseJson<T>(stdout: string): T | undefined {
  const start = stdout.indexOf("{");
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(stdout.slice(start)) as { status?: string; result?: T };
    if (parsed.status && parsed.status !== "success") return undefined;
    return parsed.result;
  } catch {
    return undefined;
  }
}
