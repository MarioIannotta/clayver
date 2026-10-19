#!/usr/bin/env node
// Sets one version across the whole monorepo and cuts the changelog.
//
//   node scripts/version.mjs <new-version> [--dry-run] [--date YYYY-MM-DD]
//
// Updates every source listed in scripts/version-sources.mjs (npm packages,
// podspecs, pubspec, Gradle, the Swift/TypeScript version constants, the CLI's
// SDK coordinates and the install snippets in docs), then moves the
// "## [Unreleased]" section of CHANGELOG.md under "## [<new-version>] - <date>".
// Run scripts/check-versions.mjs afterwards (it runs in CI and on release).
// No dependencies; Node 20+.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apply, CHANGELOG, inspect, releaseChangelog, ROOT, rootVersion, SEMVER } from "./version-sources.mjs";

function usage(code = 1) {
  console.error("usage: node scripts/version.mjs <new-version> [--dry-run] [--date YYYY-MM-DD]");
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) usage(0);
const dryRun = args.includes("--dry-run");
const dateIdx = args.indexOf("--date");
const date = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);
const positional = args.filter((a, i) => !a.startsWith("--") && !(dateIdx >= 0 && i === dateIdx + 1));
if (positional.length !== 1) usage();

const version = positional[0].replace(/^v/, "");
if (!SEMVER.test(version)) {
  console.error(`error: "${positional[0]}" is not a semantic version (e.g. 1.2.3 or 1.3.0-beta.1)`);
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error(`error: --date must be YYYY-MM-DD`);
  process.exit(1);
}

const current = rootVersion();
console.log(`${dryRun ? "[dry run] " : ""}${current} -> ${version}`);

// 1. CHANGELOG.md, checked first so a missing changelog entry changes nothing.
const changelogPath = join(ROOT, CHANGELOG);
let changelog;
try {
  changelog = releaseChangelog(readFileSync(changelogPath, "utf8"), version, date);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

// 2. Version sources.
const verb = dryRun ? "would update" : "updated";
const { changed, problems } = apply(version, { dryRun: true });
if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`);
  console.error("Some version sources were not found; nothing was changed. Update scripts/version-sources.mjs to match the files.");
  process.exit(1);
}
if (!dryRun) apply(version);
for (const file of changed) console.log(`  ${verb} ${file}`);
if (!changed.length) console.log(`  every version source already says ${version}`);

if (changelog.changed) {
  if (!dryRun) writeFileSync(changelogPath, changelog.text);
  console.log(`  ${verb} ${CHANGELOG}: Unreleased -> [${version}] - ${date}`);
} else {
  console.log(`  ${CHANGELOG} ${changelog.reason}; left unchanged`);
}

// 3. Verify.
if (!dryRun) {
  const bad = inspect(version).filter((r) => !r.ok);
  if (bad.length) {
    for (const r of bad) console.error(`error: ${r.file} ${r.name}: ${r.missing ? "not found" : `${r.found} != ${r.expected}`}`);
    process.exit(1);
  }
  console.log(`\nAll version sources say ${version}. Next:`);
  console.log(`  git commit -am "Release v${version}" && git tag v${version} && git push origin HEAD v${version}`);
}
