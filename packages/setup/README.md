# clayver — setup CLI

`npx clayver init` sets up [Clayver](../../README.md) in-app customer support in **your own Firebase
project**: it detects your app, picks the Firebase project, merges Clayver's security rules into
yours, deploys Clayver's Cloud Functions, walks you through push
notifications, writes an example integration and sets up the agent dashboard. Everything it creates or changes is recorded in
`clayver.json`, so `clayver update` and `clayver remove` know exactly what to touch.

```sh
cd path/to/your/app
npx clayver init            # interactive
npx clayver init --dry-run  # show every change and command, write nothing

cd clayver-dashboard && npm install && npm start   # the agent dashboard on http://localhost:5173
```

## Requirements

- Node.js 20.17 or newer.
- The Firebase CLI, signed in: `npm install -g firebase-tools && firebase login`.
- A Firebase project on the **Blaze** (pay-as-you-go) plan. Cloud Functions and Secret Manager need it.
- A Realtime Database instance and the default Storage bucket. If they are missing, `init` prints the console links.
- Optional: `gcloud`, signed in. With it, `init` checks billing and turns on Anonymous and
  Email/Password sign-in for you. Without it, `init` prints the console links instead.
- For `clayver admin`, Google Application Default Credentials:
  `gcloud auth application-default login` and `gcloud auth application-default set-quota-project <project>`.

## Commands

### `clayver init`

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Print every action, file diff and command without writing files, deploying or registering anything. Read-only queries such as `firebase projects:list` still run, so the plan is accurate. |
| `-y, --yes` | Accept safe defaults without asking. It creates new files, adds Clayver's own entries (for example the `clayver` rules subtree or the `clayver` functions codebase), registers the app and deploys. It **never** overwrites a file you edited, never edits `pubspec.yaml`, Gradle files or `AndroidManifest.xml`, and never deletes anything. |
| `--platform ios\|android\|flutter` | Skip platform detection. |
| `--dir <path>` | The app directory (default: the current directory). |
| `--project <firebaseProjectId>` | The Firebase project. Default: the one your config files point at, picked from `firebase projects:list`. |
| `--workspace <clayverProjectId>` | The Clayver workspace, which is `projectId` in the SDK options (default `default`). |
| `--region <region>` | The Cloud Functions region (default `us-central1`). It is written to the functions' `.env` file and into the example code. |
| `--admins <emails>` | Comma-separated emails allowed to claim the first admin seat (`CLAYVER_BOOTSTRAP_ADMINS`). Default: your Firebase CLI account. |
| `--skip-backend` | Leave `firebase.json`, the rules, and the functions alone. |
| `--skip-push` | Skip the push notification step. |
| `--skip-example` | Do not generate the example integration. |
| `--skip-dashboard` | Do not register a web app or generate `clayver-dashboard/`. |
| `--no-deploy` | Write the backend files but do not run `firebase deploy`. |
| `--verbose` | Print full diffs and every command. |

What it does, in order:

1. **Prerequisites.** Checks the Node version, the Firebase CLI and its login, and the platform
   tools (`flutter`, and `pod` for Flutter apps that still use CocoaPods for other plugins). If something is missing, it tells you how to fix it.
2. **App.** Detects iOS (`*.xcodeproj`, `Podfile`, `Package.swift`, bundle id from `project.pbxproj`),
   Android (`settings.gradle(.kts)` + the application module's `build.gradle(.kts)`, `applicationId`)
   or Flutter (`pubspec.yaml` depending on the Flutter SDK). It asks only what detection cannot answer.
3. **Firebase project.** Proposes the project named in `.firebaserc`, `google-services.json`,
   `GoogleService-Info.plist` or `lib/firebase_options.dart`, and lets you pick another one or
   create a new one. If the app is not registered yet, it runs `firebase apps:create` and writes
   the config from `firebase apps:sdkconfig`. For Flutter it offers `flutterfire configure`.
4. **Backend.** Writes or merges `firebase.json`, merges the rules, writes a `clayver-functions/`
   folder that depends on this package (the function source stays inside it), writes
   its parameters and runs
   `firebase deploy --only database,storage,functions:clayver`. It shows a diff and asks before it
   changes any existing file.
5. **Push.** Prints the APNs key upload link and the capabilities the app needs (Push
   Notifications, Background Modes > Remote notifications). On Android it checks the
   google-services plugin and offers to declare `POST_NOTIFICATIONS`.
6. **Example.** Writes a support button, the chat entry point, the sign-out and push-token
   code to `clayver-example/`. Then it offers to add the SDK dependency. That edit needs your
   explicit confirmation.
7. **Agent dashboard.** Reuses the web app it registered before, one named "Clayver dashboard",
   or one you pick (`firebase apps:list WEB`), or registers a new one (`firebase apps:create WEB`),
   reads its config (`firebase apps:sdkconfig WEB <appId>`) and writes `clayver-dashboard/`:
   `clayver.config.json`, a `package.json` whose `npm start` / `npm run deploy` run
   `clayver dashboard start|deploy --dir .`, a `firebase.json` for Hosting, a `.gitignore` and a
   README. Then `cd clayver-dashboard && npm install && npm start`. Keys you add to
   `clayver.config.json` yourself (such as `vapidKey`) survive a re-run.
8. **Manifest.** Writes `clayver.json` and prints a summary of every step and file.

Before you ship, go through the [production checklist](../../docs/production-checklist.md)
(App Check, API key restrictions, backups, monitoring, data deletion).

Running `init` again is safe. It reuses the answers from `clayver.json` and the functions `.env`
file. Files that are already up to date are skipped, and it asks before touching anything you edited.

### `clayver dashboard start`

Serves the agent dashboard that ships prebuilt inside this package, together with a
`clayver.config.json`, on `http://localhost:5173`. It is a small static server: SPA fallback to
`index.html` for routes like `/conversations/<id>`, real 404s for missing assets, no access outside
the dashboard folder, and `clayver.config.json` re-read on every request.

| Flag | Meaning |
| --- | --- |
| `--dir <path>` | The dashboard folder holding `clayver.config.json` (what `npm start` passes: `--dir .`). |
| `--port <n>` | Port. Default 5173; without the flag, the next free port is used if 5173 is taken. |
| `--host <address>` | Default `127.0.0.1` (this computer only). `--host 0.0.0.0` exposes it on your network. |

Without `--dir` it uses `./clayver.config.json`, then the folder recorded in `clayver.json`
(`clayver-dashboard/`). In an app directory with `clayver.json` but no dashboard folder,
`npx clayver dashboard start` reads the web app config from your Firebase project (read-only
`firebase apps:list|sdkconfig WEB` calls), so it works without generating anything.

### `clayver dashboard deploy [--project <id>] [--site <siteId>] [--dir <path>] [--dry-run] [--yes]`

Deploys the dashboard folder to Firebase Hosting (`npm run deploy` in `clayver-dashboard/`):

1. Writes or merges the `hosting` target in the folder's own `firebase.json` (`public: "public"`,
   SPA rewrite, cache headers). Your app's `firebase.json` is not touched. An existing hosting entry
   that serves something else is shown as a diff and replaced only after you confirm.
2. Copies the bundled dashboard and `clayver.config.json` into `public/` (generated, git-ignored).
   A `public/` folder with files Clayver did not put there is replaced only after you confirm.
3. Asks, then runs `firebase deploy --only hosting --project <project>` in that folder. This
   replaces what the site serves; use `--site` for a separate Hosting site.

The project defaults to `firebase.projectId` in `clayver.config.json`. The result is recorded in
`clayver.json`. `--dry-run` prints every step and writes or deploys nothing.

### `clayver status [--remote]`

Shows what `clayver.json` recorded and whether each file is unchanged, edited or missing. It also
says whether `clayver-functions/` already depends on this CLI version. `--remote` also lists the deployed
Clayver functions (`firebase functions:list`).

### `clayver update [--no-deploy] [--dry-run] [--yes]`

Merges the rules bundled with the **installed** CLI version and points `clayver-functions/`
at that version of the `clayver` package, then redeploys. Run `npx clayver@latest update` to
upgrade. Every change is shown as a diff and needs confirmation. With `--yes`, it replaces only
files that Clayver wrote and nobody edited since. Function source an older CLI copied into the
app is deleted.

### `clayver remove [--delete-functions] [--delete-data] [--dry-run] [--yes]`

Reverses what `clayver.json` recorded:

- Files Clayver created are deleted. If you edited one, it asks first; with `--yes` the file is kept.
- Files Clayver modified get only Clayver's part removed. That means the `rules.clayver` subtree,
  the marked block in `storage.rules`, the `clayver` codebase entry and the keys Clayver added in
  `firebase.json`, and the dependency or permission lines it inserted. Everything else stays as it is.
- Deployed functions are deleted (`firebase functions:delete clayver`) only with
  `--delete-functions` or when you confirm.
- Data under `/clayver` in the Realtime Database is deleted only after you **type the project id**.
  `--yes` never deletes data. Attachments in Cloud Storage are not deleted: `remove` prints the
  `gcloud storage rm` command instead.
- It offers to redeploy your rules so Clayver's rules leave the live project.

`clayver.json` is deleted once nothing it lists is left.

### `clayver admin grant --email <e> | --uid <uid> --role admin|agent` / `clayver admin revoke --email <e> | --uid <uid>`

Manages agents with the Firebase Admin SDK and your Application Default Credentials.
It writes the records exactly as `firebase/database.schema.md` describes. Agents are Firebase
Auth accounts of the project, so the same account works in the dashboard and in your app.

- `clayver/projects/{workspace}/agents/{uid}` = `{ role, active, email, displayName, createdAt, updatedAt, grantedBy: "clayver-cli" }`
- The custom claim `clayver_roles[workspace]`. Other claims are kept.
- `revoke` sets `active: false`, removes the claim and revokes the user's refresh tokens, which
  signs that account out on every device.
- `--display-name <name>` sets the name shown in the team list.

Neither command will remove the last active admin unless you pass `--force`.

Options: `--workspace`, `--project` and `--database-url`. By default they come from `clayver.json`
or `.firebaserc`. `--create` creates the Auth user if it is missing and prints a password setup
link. `--dry-run` prints the writes without making them.

## Files `init` writes

| File | What it is |
| --- | --- |
| `clayver.json` | The manifest: the platform, Firebase project, workspace and region, which steps ran, and every file Clayver created or modified, with a hash and instructions to undo the change. `status`, `update` and `remove` read it. Commit it. |
| `firebase.json` | Created, or merged without changing your existing settings. It points `database.rules` and `storage.rules` at the rules files, and adds a `functions` codebase `{ "source": "clayver-functions", "codebase": "clayver" }` next to your own functions. |
| `database.rules.json` | If you already have one, Clayver adds only the `rules.clayver` subtree. Your rules and comments are untouched. If a root `.read` or `.write` rule would cascade into `clayver/`, you get a warning. A `clayver` subtree that Clayver did not install, or that was edited, counts as a conflict and needs your confirmation. |
| `storage.rules` | Clayver's attachment rules go in a block between `// >>> clayver` and `// <<< clayver` inside your `match /b/{bucket}/o`. Its helper functions are renamed to `clayver_*`, so they cannot clash with yours. |
| `clayver-functions/` | A small package that depends on `clayver` and re-exports its Cloud Functions (`package.json`, `index.js`). Deploy it as the `clayver` codebase. The function source stays in the `clayver` package; `update` bumps the dependency. |
| `clayver-functions/.env.<project>` | Function parameters: `CLAYVER_BOOTSTRAP_ADMINS`, `CLAYVER_FUNCTIONS_REGION` and `CLAYVER_DASHBOARD_URL`. None of them is secret. |
| `clayver-functions/.gitignore` | Keeps `node_modules/` (from the `npm install` before deploy) out of git. |
| `.firebaserc` | Created or completed with your default project. If a different default is already set, Clayver leaves it and passes `--project` explicitly. |
| `google-services.json` / `GoogleService-Info.plist` | Downloaded only when missing and the app had to be registered. They hold public identifiers, no secrets. In Xcode, add the plist to your app target. |
| `clayver-example/ios/*.swift` | `ClayverSetup.swift`: `configure`, sign-out (`Clayver.logout()` then `Auth.auth().signOut()`), and an AppDelegate that forwards the FCM token and notification taps. `ClayverSupportButton.swift`: a SwiftUI button with an unread badge that presents `ClayverChatView`. |
| `clayver-example/android/<package>/clayver/*.kt` | `ClayverSetup.kt` (configure from `Application.onCreate`, sign-out), `ClayverMessagingService.kt` (FCM token and push handling) and `ClayverSupportButton.kt` (a Compose button with a badge, plus the `POST_NOTIFICATIONS` request). |
| `clayver-dashboard/clayver.config.json` | The dashboard's runtime config: the Firebase **web** app config (public identifiers), the workspace (`projectId`), `functionsRegion` and an empty `vapidKey` you can fill in for browser notifications. |
| `clayver-dashboard/package.json` | `npm start` → `clayver dashboard start --dir .`, `npm run deploy` → `clayver dashboard deploy --dir .`, and a devDependency on `clayver` at this CLI's version. |
| `clayver-dashboard/firebase.json`, `.gitignore`, `README.md` | Hosting target for `deploy` (serves `public/`), git-ignores `node_modules/`, `public/` and `.firebase/`, and explains the folder. `remove` deletes the folder, including `node_modules/` and `public/`. The registered web app is kept (delete it in the console if unused). |
| `clayver-example/flutter/clayver_support.dart` | `setupClayver()` (configure, FCM token, notification taps), a sign-out helper, and a `ClayverSupportButton` widget. |
| `pubspec.yaml`, `app/build.gradle(.kts)` | Changed only after you confirm. Clayver adds one dependency line, and `remove` deletes it again. iOS apps add the Swift package in Xcode (the CLI prints the URL); Clayver has no CocoaPods pod. |
| `AndroidManifest.xml` | Changed only after you confirm. Clayver adds the `POST_NOTIFICATIONS` permission line. |

The example files are samples: copy what you need into your app. They contain no secrets.

## Identity

There is no identity secret. Customers and agents are Firebase Auth users of your project: your
app signs users in with Firebase Auth and the SDK follows them (the customer id is the uid). See
[docs/identity.md](../../docs/identity.md). Projects set up by an earlier version may still have a
`CLAYVER_IDENTITY_SECRET` in Secret Manager; nothing reads it any more, so you can delete it with
`firebase functions:secrets:destroy CLAYVER_IDENTITY_SECRET`.

## How safe is it to run?

- Every external command goes through one runner. In dry-run, every command that changes
  something (`deploy`, `apps:create`, `npm install`, `functions:delete`,
  `database:remove`) is printed instead of run.
- Every file change goes through one writer. If the file already exists, the writer shows a
  unified diff and asks before writing. In dry-run it only prints.
- Clayver keeps its changes to a minimum: the `clayver` rules subtree, a marked storage block and
  its own functions codebase. That is why `remove` can undo exactly those changes.

## Developing

```sh
pnpm turbo run build --filter=clayver    # builds the functions and the dashboard first, then prepare-assets + tsc
pnpm --filter clayver test
node packages/setup/dist/cli.js init --dry-run --dir examples/android
```

`scripts/prepare-assets.mjs` copies the following into `assets/`:

- `firebase/database.rules.json` and `firebase/storage.rules`
- `firebase/functions/lib` and a cleaned-up `package.json` (no scripts, no devDependencies)
- `dashboard/dist` without source maps, as `assets/dashboard/` (served by `clayver dashboard`).
  `@clayver/dashboard` is a devDependency, so `pnpm turbo run build --filter=clayver` builds the
  dashboard first. A dashboard build with `VITE_*` project config inlined
  (`dist/build-info.json` `"embeddedConfig": true`) is refused. `CLAYVER_BUNDLE_DASHBOARD=0`
  skips the dashboard.

`prepack` runs it with `--strict`, so the package cannot be published without them.

Try the dashboard server against any config:

```sh
pnpm turbo run build --filter=clayver
node packages/setup/dist/cli.js dashboard start --dir <folder with a clayver.config.json>
```
