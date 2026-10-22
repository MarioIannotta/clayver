# Releasing Clayver

Every package in this repository shares one version. A release is a git tag
`v<version>` (for example `v0.2.0`); pushing it runs
[`.github/workflows/release.yml`](../.github/workflows/release.yml). The
day-to-day steps (`scripts/version.mjs`, commit, tag, push) are in
[CONTRIBUTING.md](../CONTRIBUTING.md#releasing). This page covers what the
workflow does and the one-time setup of each registry.

## What the workflow does

| Job | Publishes | Needs | Skipped (with a notice) when |
| --- | --- | --- | --- |
| `preflight` | Checks the tag against every version source (`scripts/check-versions.mjs --tag`) and that `CHANGELOG.md` has a section for it. Fails the release on any mismatch. | | never |
| `npm` | `clayver` (packages/setup) with [provenance](https://docs.npmjs.com/generating-provenance-statements). Pre-releases use the dist-tag `next`. Already-published versions are skipped. | repository variable `NPM_PUBLISH=true`, a trusted publisher on the package | the variable is not `true` |
| `maven` | `com.marioiannotta.clayver:clayver-android` to Maven Central through the Central Portal (`publishAndReleaseToMavenCentral`, [vanniktech maven-publish](https://vanniktech.github.io/gradle-maven-publish-plugin/)), signed with an in-memory GPG key. | secrets `MAVEN_CENTRAL_USERNAME`, `MAVEN_CENTRAL_PASSWORD`, `SIGNING_KEY`, `SIGNING_KEY_PASSWORD`, optional `SIGNING_KEY_ID` | any of the first three is not set |
| `pub` | The Flutter plugin (`flutter/`) to pub.dev with OIDC automated publishing. Runs after `maven` (the plugin depends on the Android SDK) unless it failed. Its iOS side is a Swift package that resolves `ClayverSDK` from this repository. | repository variable `PUB_DEV_PUBLISH=true`, environment `pub.dev` | the variable is not `true` |
| `github-release` | A GitHub Release named after the tag, with the changelog section. Marked as a pre-release for `-beta`/`-rc` versions. | the built-in `GITHUB_TOKEN` | never |

Swift Package Manager needs nothing: the root `Package.swift` is resolved from
the tag (SwiftPM accepts the `v` prefix). It is the only iOS distribution;
there is no CocoaPods pod.

Publishing is idempotent where the registry allows it: re-running the workflow
skips npm packages that already exist and updates the GitHub Release
in place. Maven Central and pub.dev reject a version that already exists, so
re-run only the jobs that failed.

## Secrets and variables

Set them in the repository (or organization) settings, **Settings → Secrets
and variables → Actions**.

| Name | Kind | Value |
| --- | --- | --- |
| `MAVEN_CENTRAL_USERNAME` | secret | Username of a Central Portal **user token** (not your login). |
| `MAVEN_CENTRAL_PASSWORD` | secret | Password of that user token. |
| `SIGNING_KEY` | secret | ASCII-armored GPG private key: `gpg --export-secret-keys --armor <key id>`. |
| `SIGNING_KEY_PASSWORD` | secret | The key's passphrase (leave unset if it has none). |
| `SIGNING_KEY_ID` | secret, optional | The last 8 hex characters of the key id, if the export holds several keys. |
| `NPM_PUBLISH` | variable | `true` once npm trusted publishing is set up for the `clayver` package. |
| `PUB_DEV_PUBLISH` | variable | `true` once pub.dev automated publishing is set up. |

## One-time registry setup

### npm (trusted publishing, no token)

npm publishes from GitHub Actions through [trusted publishing](https://docs.npmjs.com/trusted-publishers):
the workflow proves its identity with an OIDC token, so there is no secret to
store or rotate, and provenance is added automatically.

1. Sign in as a maintainer of the `clayver` package.
2. On npmjs.com, open the `clayver` package's **Settings** tab (visible to
   maintainers) → **Trusted Publisher** → **GitHub Actions**, with organization
   or user `MarioIannotta`, repository `clayver` and workflow filename
   `release.yml`. Optionally set **Publishing access** to require 2FA and
   disallow tokens.
3. Set the repository variable `NPM_PUBLISH` to `true`.
4. Provenance needs a public GitHub repository and the `repository` field in
   `packages/setup/package.json`, which points at `github.com/MarioIannotta/clayver`.
   If the repository lives elsewhere, update that field.

### pub.dev (OIDC, no secret)

Automated publishing can only be enabled for a package that already exists,
so the first version is published by hand:

1. Publish once from a maintainer machine:
   `cd flutter && cp ../LICENSE ../CHANGELOG.md . && flutter pub publish`
   (delete the copied files afterwards; the workflow copies them on every release).
2. On pub.dev, open the package's **Admin** tab → **Automated publishing** →
   **Enable publishing from GitHub Actions**:
   - Repository: `MarioIannotta/clayver`
   - Tag pattern: `v{{version}}`
   - Require GitHub Actions environment: **on**, environment `pub.dev`
3. In GitHub, create the environment `pub.dev` (Settings → Environments). You
   can restrict it to tags matching `v*` and add required reviewers.
4. Set the repository variable `PUB_DEV_PUBLISH` to `true`.

The `pub` job requests an OIDC token (`id-token: write`),
`dart-lang/setup-dart` exchanges it for a pub.dev credential, and
`flutter pub publish --force` publishes `flutter/` with the root `LICENSE` and
`CHANGELOG.md` copied in. pub.dev accepts the upload only from a tag that
matches the pattern and the version in `pubspec.yaml`.

### Maven Central

1. Sign in to the [Central Portal](https://central.sonatype.com) and register
   the namespace `com.marioiannotta` (the SDK's group is
   `com.marioiannotta.clayver`, which the namespace covers). Central verifies
   it with a DNS TXT record on `marioiannotta.com`. To use another domain, change the
   group (`group` and `coordinates(...)` in `android/clayver/build.gradle.kts`,
   `SDK.android.coordinates` in the CLI, and the docs) to match.
2. **Account → Generate User Token**; store the username and password as
   `MAVEN_CENTRAL_USERNAME` and `MAVEN_CENTRAL_PASSWORD`.
3. Create a signing key and publish its public part:

   ```sh
   gpg --quick-generate-key "Clayver Releases <oss@clayver.dev>" rsa4096 sign 2y
   gpg --list-secret-keys --keyid-format short          # note the key id
   gpg --keyserver keys.openpgp.org --send-keys <key id>
   gpg --keyserver keyserver.ubuntu.com --send-keys <key id>
   gpg --export-secret-keys --armor <key id>            # -> SIGNING_KEY
   ```

The build reads these as Gradle properties (`ORG_GRADLE_PROJECT_*`). Without a
signing key the build leaves publications unsigned, so
`./gradlew :clayver:publishToMavenLocal` and composite builds keep working
locally. The POM declares Apache-2.0, the GitHub SCM URLs and the developers;
Central rejects a deployment without sources, javadoc and signatures, which
the plugin adds. `publishAndReleaseToMavenCentral` waits for validation and
releases automatically.

## Repository settings worth enabling

- **Private vulnerability reporting** (Settings → Code security), which
  [SECURITY.md](../SECURITY.md) relies on.
- A tag protection ruleset for `v*` so only maintainers can start a release.
- Dependabot alerts and security updates (`.github/dependabot.yml` configures
  version updates).

## If something fails

- **`preflight` fails**: the tag and the files disagree. Delete the tag
  (`git push --delete origin v0.2.0 && git tag -d v0.2.0`), run
  `node scripts/version.mjs 0.2.0`, commit and tag again.
- **One registry fails**: fix the cause and use **Re-run failed jobs**. The
  other registries are not published twice.
- **A bad version reached a registry**: registries do not allow replacing a
  version. Publish a patch release. On npm you can `npm deprecate`, on pub.dev
  retract the version (Admin tab).
