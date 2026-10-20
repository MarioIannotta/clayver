#!/usr/bin/env node
// Copies the Clayver backend (security rules, built Cloud Functions) and the
// prebuilt agent dashboard from the monorepo into packages/setup/assets so that
// the published `clayver` package carries exactly what it was released with.
//
//   node scripts/prepare-assets.mjs           # warn about missing pieces
//   node scripts/prepare-assets.mjs --strict  # fail on missing pieces (prepack)
//
// Sources (override the firebase dir with CLAYVER_FIREBASE_SRC):
//   ../../firebase/database.rules.json
//   ../../firebase/storage.rules
//   ../../firebase/functions/{package.json,lib/**/*.js}
//   ../../dashboard/dist/**   (override with CLAYVER_DASHBOARD_SRC; skip with CLAYVER_BUNDLE_DASHBOARD=0)
//
// Turborepo builds @clayver/dashboard first (it is a devDependency), and the
// dashboard build must be environment-independent: a build with VITE_* values
// inlined (dist/build-info.json "embeddedConfig": true) is refused.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const strict = process.argv.includes("--strict");
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const repoRoot = resolve(pkgDir, "../..");
const firebaseSrc = resolve(process.env.CLAYVER_FIREBASE_SRC ?? join(repoRoot, "firebase"));
const dashboardSrc = resolve(process.env.CLAYVER_DASHBOARD_SRC ?? join(repoRoot, "dashboard", "dist"));
const out = join(pkgDir, "assets");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

const problems = [];
function problem(msg) {
  problems.push(msg);
  console.warn(`[prepare-assets] ${strict ? "error" : "warning"}: ${msg}`);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const hashes = {};
function copyFile(src, rel) {
  const dest = join(out, rel);
  mkdirSync(dirname(dest), { recursive: true });
  const buf = readFileSync(src);
  writeFileSync(dest, buf);
  hashes[rel.split(sep).join("/")] = sha256(buf);
}

// 1. Security rules.
for (const name of ["database.rules.json", "storage.rules"]) {
  const src = join(firebaseSrc, name);
  if (!existsSync(src)) {
    problem(`missing ${relative(repoRoot, src)}`);
    continue;
  }
  if (name.endsWith(".json")) {
    const parsed = JSON.parse(readFileSync(src, "utf8"));
    if (!parsed?.rules?.clayver) problem(`${name} has no "rules.clayver" subtree`);
  }
  copyFile(src, name);
}

// 2. Cloud Functions: built lib + a sanitized package.json.
const functionsSrc = join(firebaseSrc, "functions");
const functionNames = [];
let functionsVersion = null;
if (!existsSync(join(functionsSrc, "package.json"))) {
  problem(`missing ${relative(repoRoot, join(functionsSrc, "package.json"))}`);
} else if (!existsSync(join(functionsSrc, "lib", "index.js"))) {
  problem(
    `missing ${relative(repoRoot, join(functionsSrc, "lib/index.js"))}; build the functions first ` +
      "(pnpm --filter @clayver/functions build)",
  );
} else {
  const fpkg = JSON.parse(readFileSync(join(functionsSrc, "package.json"), "utf8"));
  functionsVersion = fpkg.version ?? null;
  const deps = { ...(fpkg.dependencies ?? {}) };
  for (const [name, range] of Object.entries(deps)) {
    if (String(range).startsWith("workspace:")) {
      problem(`functions dependency ${name}@${range} cannot be deployed outside the monorepo`);
      delete deps[name];
    }
  }
  const sanitized = {
    name: "clayver-functions",
    version: fpkg.version ?? "0.0.0",
    private: true,
    description: "Clayver Cloud Functions. Apps depend on the `clayver` package and re-export this entry; the source is not copied into the app.",
    license: fpkg.license ?? "Apache-2.0",
    main: fpkg.main ?? "lib/index.js",
    // Keeps these .js files CommonJS when the published `clayver` package is `"type": "module"`.
    type: "commonjs",
    engines: fpkg.engines ?? { node: "20" },
    dependencies: deps,
  };
  const pkgText = `${JSON.stringify(sanitized, null, 2)}\n`;
  mkdirSync(join(out, "functions"), { recursive: true });
  writeFileSync(join(out, "functions", "package.json"), pkgText);
  hashes["functions/package.json"] = sha256(pkgText);

  const libDir = join(functionsSrc, "lib");
  for (const file of walk(libDir)) {
    const rel = relative(libDir, file);
    if (!file.endsWith(".js") && !file.endsWith(".cjs") && !file.endsWith(".json")) continue;
    if (/\.test\.(c?js)$/.test(file) || rel.split(sep).includes("__tests__")) continue;
    copyFile(file, join("functions", "lib", rel));
  }

  // Exported function names, for `clayver status`.
  const index = readFileSync(join(libDir, "index.js"), "utf8");
  const patterns = [/exports\.([A-Za-z_$][\w$]*)\s*=/g, /Object\.defineProperty\(exports,\s*["']([\w$]+)["']/g, /export\s+(?:const|let|var|function)\s+([\w$]+)/g];
  for (const re of patterns) {
    for (const m of index.matchAll(re)) {
      if (m[1] !== "__esModule" && !functionNames.includes(m[1])) functionNames.push(m[1]);
    }
  }
}

// 3. The prebuilt dashboard. It loads its configuration at runtime
// (clayver.config.json), so one build serves every Firebase project.
let dashboard = false;
if (process.env.CLAYVER_BUNDLE_DASHBOARD === "0") {
  console.log("[prepare-assets] dashboard not bundled (CLAYVER_BUNDLE_DASHBOARD=0)");
} else if (!existsSync(join(dashboardSrc, "index.html"))) {
  problem(`missing ${relative(repoRoot, join(dashboardSrc, "index.html"))}; build the dashboard first (pnpm --filter @clayver/dashboard build)`);
} else {
  let info = null;
  try {
    info = JSON.parse(readFileSync(join(dashboardSrc, "build-info.json"), "utf8"));
  } catch {
    info = null;
  }
  if (info?.embeddedConfig) {
    problem(
      `the dashboard build has project config inlined (${(info.embeddedVariables ?? []).join(", ")}); ` +
        "rebuild it without VITE_FIREBASE_*/VITE_CLAYVER_* variables (e.g. move dashboard/.env.local away) so the CLI ships an environment-independent build",
    );
  } else {
    if (!info) console.warn("[prepare-assets] warning: dashboard/dist/build-info.json is missing; cannot verify the build carries no project config");
    for (const file of walk(dashboardSrc)) {
      const rel = relative(dashboardSrc, file);
      // Source maps are large and not needed to run it; build-info is for this script only.
      if (file.endsWith(".map") || rel === "build-info.json") continue;
      copyFile(file, join("dashboard", rel));
    }
    dashboard = true;
  }
}

const meta = {
  cliVersion: pkg.version,
  generatedAt: new Date().toISOString(),
  functionsVersion,
  functionNames: functionNames.filter((n) => n !== "default"),
  dashboard,
  files: hashes,
  complete: problems.length === 0,
};
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

if (problems.length && strict) {
  console.error(`[prepare-assets] ${problems.length} problem(s); refusing to package an incomplete backend.`);
  process.exit(1);
}
console.log(
  `[prepare-assets] wrote ${Object.keys(hashes).length} file(s) to ${relative(repoRoot, out)}` +
    (problems.length ? ` (${problems.length} warning(s))` : ""),
);
