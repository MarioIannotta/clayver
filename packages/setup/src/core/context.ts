import { ConsoleLogger, type Logger } from "./logger.js";
import { InquirerPrompter, NonInteractivePrompter, type Prompter } from "./prompter.js";
import { DryRunRunner, ProcessRunner, type Runner } from "./runner.js";
import { FileOps } from "./files.js";
import type { FileRecord } from "./manifest.js";
import { FirebaseCli } from "../firebase/cli.js";
import type { FetchLike } from "../firebase/gcp.js";

export interface CommonOptions {
  dryRun?: boolean;
  yes?: boolean;
  verbose?: boolean;
  dir?: string;
}

/** Everything a command needs from the outside world; tests replace each piece. */
export interface Deps {
  runner: Runner;
  prompter: Prompter;
  logger: Logger;
  cwd: string;
  fetch: FetchLike;
  /** Overrides the bundled backend assets directory. */
  assetsDir?: string;
  /** Overrides process.versions.node (tests). */
  nodeVersion?: string;
  color?: boolean;
  now?: () => Date;
}

export interface Ctx {
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
  runner: Runner;
  prompter: Prompter;
  logger: Logger;
  fb: FirebaseCli;
  fetch: FetchLike;
  deps: Deps;
  now: () => Date;
}

export function defaultDeps(opts: CommonOptions): Deps {
  const logger = new ConsoleLogger();
  const prompter: Prompter = opts.yes
    ? new NonInteractivePrompter(true)
    : process.stdin.isTTY
      ? new InquirerPrompter()
      : new NonInteractivePrompter(false);
  return {
    runner: new ProcessRunner(logger, opts.verbose),
    prompter,
    logger,
    cwd: process.cwd(),
    fetch: (url, init) => fetch(url, init),
    color: process.stdout.isTTY && !process.env.NO_COLOR,
  };
}

/** Wraps the runner for dry-run so that no mutating command can execute. */
export function makeCtx(opts: CommonOptions, deps: Deps): Ctx {
  const dryRun = !!opts.dryRun;
  const runner = dryRun ? new DryRunRunner(deps.runner, deps.logger) : deps.runner;
  return {
    dryRun,
    yes: !!opts.yes,
    verbose: !!opts.verbose,
    runner,
    prompter: deps.prompter,
    logger: deps.logger,
    fb: new FirebaseCli(runner),
    fetch: deps.fetch,
    deps,
    now: deps.now ?? (() => new Date()),
  };
}

export function makeFileOps(ctx: Ctx, baseDir: string, previous?: FileRecord[]): FileOps {
  return new FileOps({
    baseDir,
    dryRun: ctx.dryRun,
    prompter: ctx.prompter,
    logger: ctx.logger,
    previous,
    color: ctx.deps.color ?? false,
    verbose: ctx.verbose,
  });
}
