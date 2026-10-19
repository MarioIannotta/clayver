import pc from "picocolors";

export interface Logger {
  /** Section header for a numbered step. */
  step(title: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Dimmed secondary information. */
  detail(message: string): void;
  /** An action that dry-run skipped ("would run ..."). */
  dryRun(message: string): void;
  /** Unformatted output such as diffs and code snippets. */
  raw(message: string): void;
}

export class ConsoleLogger implements Logger {
  constructor(private readonly out: NodeJS.WritableStream = process.stdout) {}
  private write(line: string) {
    this.out.write(`${line}\n`);
  }
  step(title: string) {
    this.write(`\n${pc.bold(pc.cyan(`▸ ${title}`))}`);
  }
  info(message: string) {
    this.write(`  ${message}`);
  }
  success(message: string) {
    this.write(`  ${pc.green("✓")} ${message}`);
  }
  warn(message: string) {
    this.write(`  ${pc.yellow("!")} ${pc.yellow(message)}`);
  }
  error(message: string) {
    this.write(`  ${pc.red("✗")} ${pc.red(message)}`);
  }
  detail(message: string) {
    this.write(pc.dim(`    ${message}`));
  }
  dryRun(message: string) {
    this.write(`  ${pc.magenta("[dry-run]")} ${message}`);
  }
  raw(message: string) {
    this.write(message);
  }
}

export interface LogEntry {
  level: "step" | "info" | "success" | "warn" | "error" | "detail" | "dryRun" | "raw";
  message: string;
}

/** Collects log lines in memory (tests, programmatic use). */
export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];
  private push(level: LogEntry["level"], message: string) {
    this.entries.push({ level, message });
  }
  step(m: string) { this.push("step", m); }
  info(m: string) { this.push("info", m); }
  success(m: string) { this.push("success", m); }
  warn(m: string) { this.push("warn", m); }
  error(m: string) { this.push("error", m); }
  detail(m: string) { this.push("detail", m); }
  dryRun(m: string) { this.push("dryRun", m); }
  raw(m: string) { this.push("raw", m); }
  text(): string {
    return this.entries.map((e) => `[${e.level}] ${e.message}`).join("\n");
  }
}
