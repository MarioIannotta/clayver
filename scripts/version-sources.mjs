// Every place in the monorepo that carries the Clayver release version.
// Shared by scripts/version.mjs (writes) and scripts/check-versions.mjs (verifies).
//
// Each entry names a file and one or more patterns. A pattern has exactly three
// capture groups: (text before)(the version text)(text after). `render(version)`
// gives the text the middle group must hold for a release `version`, so sources
// that store a derived value (a `^` range, a `~> major.minor` constraint) are
// checked and updated like the others.
//
// `optional: true` files may be absent (the entry is skipped). Every pattern of a
// present file must match at least once; `all: true` patterns are applied to every
// match (used for docs that mention the version several times).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Semantic Versioning 2.0.0 (no leading "v"). */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const exact = (v) => v;
const caret = (v) => v; // the "^" lives in the prefix group

// A version-looking token: digits, dots, and pre-release/build characters.
const V = "(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.+-]*)?)";

const packageJson = (file, optional = false) => ({
  file,
  optional,
  patterns: [{ name: "version", re: new RegExp(`^(  "version":\\s*")${V}(")`, "m"), render: exact }],
});

export const SOURCES = [
  // npm packages
  packageJson("package.json"),
  packageJson("packages/setup/package.json"),
  packageJson("packages/core/package.json"),
  packageJson("dashboard/package.json"),
  packageJson("firebase/functions/package.json", true),
  packageJson("firebase/tests/package.json", true),

  // Version constants hardcoded in source
  {
    file: "packages/core/src/push.ts",
    patterns: [{ name: "SDK_VERSION", re: new RegExp(`(export const SDK_VERSION = ")${V}(")`), render: exact }],
  },
  {
    file: "packages/setup/src/constants.ts",
    patterns: [
      { name: "SDK.version", re: new RegExp(`(export const SDK = \\{\\s*version: ")${V}(")`), render: exact },
      {
        name: "SDK.android.version",
        re: new RegExp(`(coordinates: "com\\.clayver:clayver-android",\\s*version: ")${V}(")`),
        render: exact,
      },
      { name: "SDK.flutter.version", re: new RegExp(`(package: "clayver",\\s*version: "\\^)${V}(")`), render: caret },
    ],
  },
  {
    // Expectations derived from SDK.* in constants.ts.
    file: "packages/setup/test/manifest.test.ts",
    optional: true,
    patterns: [{ name: "android dependency line", re: new RegExp(`(com\\.clayver:clayver-android:)${V}(")`, "g"), render: exact, all: true }],
  },
  {
    file: "packages/setup/test/platforms.test.ts",
    optional: true,
    patterns: [
      { name: "pubspec dependency line", re: new RegExp(`(clayver: \\^)${V}(\\\\n)`, "g"), render: caret, all: true },
    ],
  },

  // iOS
  {
    file: "ios/Sources/ClayverSDK/Clayver.swift",
    patterns: [{ name: "sdkVersion", re: new RegExp(`(public static let sdkVersion = ")${V}(")`), render: exact }],
  },

  // Android
  {
    file: "android/clayver/build.gradle.kts",
    patterns: [{ name: "version", re: new RegExp(`^(version = ")${V}(")`, "m"), render: exact }],
  },

  // Flutter plugin
  {
    file: "flutter/pubspec.yaml",
    patterns: [{ name: "version", re: new RegExp(`^(version:[ \\t]*)${V}([ \\t]*)$`, "m"), render: exact }],
  },
  {
    file: "flutter/android/build.gradle",
    patterns: [
      { name: "version", re: new RegExp(`^(version = ")${V}(")`, "m"), render: exact },
      {
        name: "clayverAndroidVersion default",
        re: new RegExp(`(findProperty\\("clayver\\.androidSdkVersion"\\) \\?: ")${V}(")`),
        render: exact,
      },
    ],
  },

  // Install snippets in docs and examples
  {
    file: "android/README.md",
    optional: true,
    patterns: [{ name: "Maven coordinates", re: new RegExp(`(com\\.clayver:clayver-android:)${V}()`, "g"), render: exact, all: true }],
  },
  {
    file: "flutter/README.md",
    optional: true,
    patterns: [
      { name: "pubspec snippet", re: new RegExp(`(^\\s*clayver: \\^)${V}()`, "gm"), render: caret, all: true },
      { name: "git tag", re: new RegExp(`(:tag => 'v)${V}(')`, "g"), render: exact, all: true, optionalMatch: true },
    ],
  },
  {
    file: "examples/android/app/build.gradle.kts",
    optional: true,
    patterns: [{ name: "dependency", re: new RegExp(`(com\\.clayver:clayver-android:)${V}(")`, "g"), render: exact, all: true }],
  },
];

/** Reads the canonical version (root package.json). */
export function rootVersion(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

function globalRe(re) {
  return re.global ? new RegExp(re.source, re.flags) : new RegExp(re.source, `${re.flags}g`);
}

/**
 * Inspects every source. Returns one row per match:
 * { file, name, found, expected, ok } plus { file, name, missing: true } rows for
 * required files or patterns that were not found.
 */
export function inspect(version, root = ROOT) {
  const rows = [];
  for (const source of SOURCES) {
    const path = join(root, source.file);
    if (!existsSync(path)) {
      if (!source.optional) rows.push({ file: source.file, name: "(file)", missing: true, ok: false });
      continue;
    }
    const text = readFileSync(path, "utf8");
    for (const p of source.patterns) {
      const matches = p.all ? [...text.matchAll(globalRe(p.re))] : [text.match(new RegExp(p.re.source, p.re.flags.replace("g", "")))].filter(Boolean);
      if (matches.length === 0) {
        if (!p.optionalMatch) rows.push({ file: source.file, name: p.name, missing: true, ok: false });
        continue;
      }
      const expected = p.render(version);
      for (const m of matches) rows.push({ file: source.file, name: p.name, found: m[2], expected, ok: m[2] === expected });
    }
  }
  return rows;
}

/** Rewrites every source to `version`. Returns the list of files changed. */
export function apply(version, { root = ROOT, dryRun = false } = {}) {
  const changed = [];
  const problems = [];
  for (const source of SOURCES) {
    const path = join(root, source.file);
    if (!existsSync(path)) {
      if (!source.optional) problems.push(`${source.file}: file not found`);
      continue;
    }
    const before = readFileSync(path, "utf8");
    let text = before;
    for (const p of source.patterns) {
      const re = p.all ? globalRe(p.re) : new RegExp(p.re.source, p.re.flags.replace("g", ""));
      if (!re.test(text)) {
        if (!p.optionalMatch) problems.push(`${source.file}: no match for ${p.name}`);
        continue;
      }
      re.lastIndex = 0;
      text = text.replace(re, (_all, pre, _old, post) => `${pre}${p.render(version)}${post}`);
    }
    if (text !== before) {
      changed.push(source.file);
      if (!dryRun) writeFileSync(path, text);
    }
  }
  return { changed, problems };
}

// ---------------------------------------------------------------------------
// CHANGELOG.md (Keep a Changelog 1.1.0)

export const CHANGELOG = "CHANGELOG.md";
export const REPO_URL = "https://github.com/MarioIannotta/clayver";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of `## [version]` (without the heading), or null. */
export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^## \\[${escapeRe(version)}\\]`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  // Drop the link reference definitions at the bottom if the section is the last one.
  const body = lines.slice(start + 1, end).filter((l) => !/^\[[^\]]+\]: https?:\/\//.test(l));
  return body.join("\n").trim();
}

/**
 * Moves the Unreleased section under `## [version] - date`, leaves an empty
 * Unreleased section, and updates the compare links at the bottom.
 */
export function releaseChangelog(text, version, date) {
  if (new RegExp(`^## \\[${escapeRe(version)}\\]`, "m").test(text)) {
    return { text, changed: false, reason: `already has a section for ${version}` };
  }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (start < 0) throw new Error(`${CHANGELOG} has no "## [Unreleased]" section`);
  let end = lines.findIndex((l, i) => i > start && (/^## /.test(l) || /^\[[^\]]+\]: https?:\/\//.test(l)));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  if (!body.some((l) => /^\s*[-*] \S/.test(l))) {
    throw new Error(`the Unreleased section of ${CHANGELOG} lists no changes; add entries before releasing`);
  }
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  while (body.length && body[0].trim() === "") body.shift();

  // Previous release, for the compare link.
  const previous = lines.slice(end).map((l) => l.match(/^## \[([^\]]+)\]/)?.[1]).find(Boolean);

  const out = [...lines.slice(0, start + 1), "", `## [${version}] - ${date}`, "", ...body, "", ...lines.slice(end)];
  let result = out.join("\n").replace(/\n{3,}/g, "\n\n");

  // Link references.
  const unreleasedLink = `[Unreleased]: ${REPO_URL}/compare/v${version}...HEAD`;
  const versionLink = previous
    ? `[${version}]: ${REPO_URL}/compare/v${previous}...v${version}`
    : `[${version}]: ${REPO_URL}/releases/tag/v${version}`;
  if (/^\[Unreleased\]: .*$/m.test(result)) {
    result = result.replace(/^\[Unreleased\]: .*$/m, `${unreleasedLink}\n${versionLink}`);
  } else {
    result = `${result.replace(/\n*$/, "")}\n\n${unreleasedLink}\n${versionLink}\n`;
  }
  return { text: result, changed: true };
}
