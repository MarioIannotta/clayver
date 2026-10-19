import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ClayverError } from "./errors.js";

export interface AssetsMeta {
  cliVersion: string;
  generatedAt: string;
  functionsVersion: string | null;
  functionNames: string[];
  dashboard: boolean;
  files: Record<string, string>;
  complete: boolean;
}

export interface Assets {
  dir: string;
  meta: AssetsMeta;
  databaseRules: string;
  storageRules: string;
  /** Relative path (forward slashes) → content, for the functions source folder. */
  functionsFiles: Map<string, Buffer>;
  /** Static dashboard build, when bundled. */
  dashboardFiles?: Map<string, Buffer>;
}

export function defaultAssetsDir(): string {
  return process.env.CLAYVER_ASSETS_DIR ?? fileURLToPath(new URL("../../assets/", import.meta.url));
}

function walk(dir: string, base = dir, out = new Map<string, Buffer>()): Map<string, Buffer> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.set(relative(base, full).split(sep).join("/"), readFileSync(full));
  }
  return out;
}

/** Folder of the prebuilt dashboard bundled with the CLI (may not exist in a partial build). */
export function dashboardAssetsDir(assetsDir = defaultAssetsDir()): string {
  return join(assetsDir, "dashboard");
}

export function requireDashboardAssets(assetsDir = defaultAssetsDir()): string {
  const dir = dashboardAssetsDir(assetsDir);
  if (!existsSync(join(dir, "index.html"))) {
    throw new ClayverError(
      `This copy of the clayver CLI has no prebuilt dashboard (${dir}/index.html is missing).`,
      "Reinstall it (`npm install clayver@latest`), or, in the Clayver repo, run `pnpm turbo run build --filter=clayver`.",
    );
  }
  return dir;
}

const REBUILD_HINT =
  "This copy of the clayver CLI was built without its backend assets. Reinstall it (`npx clayver@latest`), " +
  "or, in the Clayver repo, run `pnpm --filter @clayver/functions build && pnpm --filter clayver build`.";

export function loadAssets(dir = defaultAssetsDir()): Assets {
  const need = (rel: string) => {
    const p = join(dir, rel);
    if (!existsSync(p)) throw new ClayverError(`Missing backend asset ${rel} in ${dir}.`, REBUILD_HINT);
    return p;
  };
  const meta = JSON.parse(readFileSync(need("meta.json"), "utf8")) as AssetsMeta;
  const databaseRules = readFileSync(need("database.rules.json"), "utf8");
  const storageRules = readFileSync(need("storage.rules"), "utf8");
  need("functions/package.json");
  const functionsFiles = walk(join(dir, "functions"));
  if (![...functionsFiles.keys()].some((k) => k.startsWith("lib/"))) {
    throw new ClayverError(`The bundled Cloud Functions in ${dir} have no lib/ folder.`, REBUILD_HINT);
  }
  const dashDir = join(dir, "dashboard");
  const dashboardFiles = existsSync(join(dashDir, "index.html")) ? walk(dashDir) : undefined;
  return { dir, meta, databaseRules, storageRules, functionsFiles, dashboardFiles };
}
