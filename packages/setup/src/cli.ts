#!/usr/bin/env node
import { Command, Option } from "commander";
import pc from "picocolors";
import { CLI_VERSION, DEFAULT_WORKSPACE } from "./constants.js";
import { defaultDeps, type CommonOptions } from "./core/context.js";
import { ClayverError } from "./core/errors.js";
import { runAdmin, type AdminOptions } from "./commands/admin.js";
import { runDevDashboard, runDevDeploy, runDevSetup, type DevOptions } from "./commands/dev.js";
import { runDashboardDeploy, runDashboardStart, type DashboardDeployOptions, type DashboardStartOptions } from "./commands/dashboard.js";
import { runInit, type InitOptions } from "./commands/init.js";
import { runRemove, type RemoveOptions } from "./commands/remove.js";
import { runStatus, type StatusOptions } from "./commands/status.js";
import { runUpdate, type UpdateOptions } from "./commands/update.js";

function common(cmd: Command, opts: { dir?: boolean } = { dir: true }): Command {
  cmd
    .option("--dry-run", "print every action, file diff and command without writing, deploying or deleting anything")
    .option("-y, --yes", "accept safe defaults without asking (never overwrites edited files or deletes data)")
    .option("--verbose", "print full diffs and every command");
  if (opts.dir) cmd.option("--dir <path>", "app directory (default: current directory)");
  return cmd;
}

async function run(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const err = e as Error & { hint?: string; exitCode?: number };
    if (err?.name === "ExitPromptError" || err?.name === "AbortPromptError") {
      process.stderr.write(`\n${pc.yellow("Cancelled.")} Nothing after the last confirmed step was changed.\n`);
      process.exitCode = 130;
      return;
    }
    if (e instanceof ClayverError) {
      process.stderr.write(`\n${pc.red("✗")} ${err.message}\n`);
      if (err.hint) process.stderr.write(`  ${pc.dim("→")} ${err.hint}\n`);
      process.exitCode = err.exitCode ?? 1;
      return;
    }
    process.stderr.write(`\n${pc.red("Unexpected error:")} ${err?.stack ?? String(e)}\n`);
    process.exitCode = 1;
  }
}

const program = new Command()
  .name("clayver")
  .description("Set up Clayver in-app customer support in your own Firebase project.")
  .version(CLI_VERSION);

common(
  program
    .command("init")
    .description("detect your app, configure Firebase, deploy Clayver's backend and generate an example integration")
    .addOption(new Option("--platform <platform>", "app platform (skips detection)").choices(["ios", "android", "flutter"]))
    .option("--project <firebaseProjectId>", "Firebase project to use")
    .option("--workspace <clayverProjectId>", `Clayver workspace, the projectId in the SDK options (default: ${DEFAULT_WORKSPACE})`)
    .option("--region <region>", "Cloud Functions region (default: us-central1)")
    .option("--admins <emails>", "comma-separated emails allowed to become the first admin")
    .option("--skip-backend", "do not touch firebase.json, rules or functions")
    .option("--skip-push", "skip push notification setup")
    .option("--skip-example", "do not generate the example integration")
    .option("--skip-dashboard", "do not register a web app or generate the clayver-dashboard/ folder")
    .option("--no-deploy", "write the backend files but do not run firebase deploy"),
).action((opts: InitOptions) => run(() => runInit(opts, defaultDeps(opts))));

common(
  program.command("status").description("show what clayver.json recorded and whether files or functions drifted").option("--remote", "also list the deployed Clayver functions"),
).action((opts: StatusOptions) => run(() => runStatus(opts, defaultDeps(opts))));

common(
  program
    .command("update")
    .description("merge rules from this CLI version, point the functions at it, and redeploy")
    .option("--no-deploy", "update files only"),
).action((opts: UpdateOptions) => run(() => runUpdate(opts, defaultDeps(opts))));

common(
  program
    .command("remove")
    .description("undo everything clayver.json recorded; optionally delete the deployed functions and data")
    .option("--delete-functions", "also delete the deployed `clayver` functions codebase")
    .option("--delete-data", "also offer to delete /clayver data (requires typing the project id)"),
).action((opts: RemoveOptions) => run(() => runRemove(opts, defaultDeps(opts))));

const dashboard = program.command("dashboard").description("run the agent dashboard locally or deploy it to Firebase Hosting");

dashboard
  .command("start")
  .description("serve the agent dashboard bundled with this CLI, with the clayver.config.json that init generated")
  .option("--dir <path>", "dashboard folder holding clayver.config.json (default: ., ./clayver-dashboard via clayver.json)")
  .option("--port <port>", "port (default: 5173, or the next free one)")
  .option("--host <host>", "address to listen on (default: 127.0.0.1, only this computer)")
  .option("--verbose", "print every command")
  .action((opts: DashboardStartOptions) =>
    run(async () => {
      const handle = await runDashboardStart(opts, defaultDeps(opts));
      const stop = () => {
        void handle.close().then(() => process.exit(0));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    }),
  );

common(
  dashboard
    .command("deploy")
    .description("deploy the agent dashboard to Firebase Hosting (writes the hosting target in the dashboard folder's firebase.json)")
    .option("--project <firebaseProjectId>", "Firebase project (default: firebase.projectId in clayver.config.json)")
    .option("--site <siteId>", "Firebase Hosting site (default: the project's default site)"),
).action((opts: DashboardDeployOptions) => run(() => runDashboardDeploy(opts, defaultDeps(opts))));

const admin = program.command("admin").description("manage agents (Firebase Auth accounts) with your Google credentials (Application Default Credentials)");

function adminCmd(name: "grant" | "revoke", description: string) {
  const cmd = admin
    .command(name)
    .description(description)
    .option("--email <email>", "the agent's Firebase Auth email")
    .option("--uid <firebaseUid>", "the agent's Firebase Auth uid (for accounts without an email)")
    .option("--workspace <clayverProjectId>", "Clayver workspace (default: from clayver.json, else default)")
    .option("--project <firebaseProjectId>", "Firebase project (default: from clayver.json or .firebaserc)")
    .option("--database-url <url>", "Realtime Database URL (default: from clayver.json, else https://<project>-default-rtdb.firebaseio.com)")
    .option("--force", "allow removing the last active admin")
    .option("--dry-run", "print the writes without making them")
    .option("--dir <path>", "app directory holding clayver.json");
  return cmd;
}

adminCmd("grant", "make a user an admin or agent of a workspace")
  .addOption(new Option("--role <role>", "role to grant").choices(["admin", "agent"]).makeOptionMandatory())
  .option("--create", "create the Firebase Auth user if it does not exist and print a password setup link")
  .option("--display-name <name>", "name shown in the dashboard's team list")
  .action((opts: AdminOptions) => run(() => runAdmin("grant", opts, defaultDeps(opts as CommonOptions))));

adminCmd("revoke", "remove a user's role in a workspace").action((opts: AdminOptions) =>
  run(() => runAdmin("revoke", opts, defaultDeps(opts as CommonOptions))),
);

// For working on Clayver itself: runs the repository's backend, dashboard and example apps
// against your own Firebase project (`pnpm dev:setup` and friends). Hidden from --help.
const dev = program.command("dev", { hidden: true }).description("run this repository's backend, dashboard and examples against your Firebase project");
dev
  .command("setup")
  .description("check a Firebase project, deploy the backend and configure the dashboard and example apps")
  .option("--project <firebaseProjectId>", "Firebase project to use")
  .option("--verbose", "print every command")
  .action((opts: DevOptions) => run(() => runDevSetup(opts, defaultDeps(opts))));
dev
  .command("deploy")
  .description("redeploy the rules and Cloud Functions to the dev project")
  .option("--verbose", "print every command")
  .action((opts: DevOptions) => run(() => runDevDeploy(opts, defaultDeps(opts))));
dev
  .command("dashboard")
  .description("start the dashboard against the dev project")
  .action((opts: DevOptions) => run(() => runDevDashboard(opts, defaultDeps(opts))));

program.parseAsync(process.argv).catch((e) => {
  process.stderr.write(`${String(e)}\n`);
  process.exitCode = 1;
});
