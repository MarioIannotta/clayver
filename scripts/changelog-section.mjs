#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version (used for GitHub Release notes).
//
//   node scripts/changelog-section.mjs 1.2.3 > notes.md
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANGELOG, changelogSection, ROOT } from "./version-sources.mjs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("usage: node scripts/changelog-section.mjs <version>");
  process.exit(1);
}
const section = changelogSection(readFileSync(join(ROOT, CHANGELOG), "utf8"), version);
if (section === null) {
  console.error(`${CHANGELOG} has no section for ${version}`);
  process.exit(1);
}
process.stdout.write(`${section}\n`);
