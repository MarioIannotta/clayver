#!/usr/bin/env node
// Fails when any version source disagrees with the root package.json version.
//
//   node scripts/check-versions.mjs                 # all sources agree with package.json
//   node scripts/check-versions.mjs --expect 1.2.3  # ...and that version is 1.2.3
//   node scripts/check-versions.mjs --tag v1.2.3    # same, from a git tag (release workflow)
//
// It also requires a "## [<version>]" section in CHANGELOG.md.
// The list of sources lives in scripts/version-sources.mjs. No dependencies.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANGELOG, changelogSection, inspect, ROOT, rootVersion, SEMVER } from "./version-sources.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const version = rootVersion();
const errors = [];

if (!SEMVER.test(version)) errors.push(`package.json version "${version}" is not a semantic version`);

const tag = flag("--tag");
const expect = flag("--expect") ?? (tag !== undefined ? tag.replace(/^refs\/tags\//, "").replace(/^v/, "") : undefined);
if (tag !== undefined && !/^(refs\/tags\/)?v/.test(tag)) errors.push(`tag "${tag}" does not start with "v"`);
if (expect !== undefined && expect !== version) {
  errors.push(`expected version ${expect}${tag ? ` (from tag ${tag})` : ""}, but package.json says ${version}`);
}

const rows = inspect(version);
for (const r of rows) {
  if (r.missing) errors.push(`${r.file}: ${r.name} not found (update scripts/version-sources.mjs if the file changed)`);
  else if (!r.ok) errors.push(`${r.file}: ${r.name} is ${r.found}, expected ${r.expected}`);
}

const changelogPath = join(ROOT, CHANGELOG);
if (!existsSync(changelogPath)) errors.push(`${CHANGELOG} is missing`);
else if (changelogSection(readFileSync(changelogPath, "utf8"), version) === null) {
  errors.push(`${CHANGELOG} has no "## [${version}]" section (run scripts/version.mjs ${version})`);
}

if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} problem(s). Run: node scripts/version.mjs ${expect ?? version}`);
  process.exit(1);
}
console.log(`All ${rows.length} version references in ${new Set(rows.map((r) => r.file)).size} files say ${version}.`);
