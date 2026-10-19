# Testing

## Running the dashboard and example apps (your own Firebase project)

To try Clayver by hand, point the repository at a Firebase project of your own:

```bash
pnpm install
pnpm dev:setup       # once, or again to switch projects
pnpm dev:dashboard   # the dashboard on http://localhost:5173
pnpm dev:deploy      # after changing the rules or functions
```

`dev:setup` asks which project to use and remembers it. It then:
- checks the Realtime Database, the Blaze plan, the sign-in providers
  (Anonymous and Email/Password, turned on for you) and Storage, and tells you
  what to create in the console while something is missing;
- deploys the rules and Cloud Functions from `firebase/` without prompts;
- writes the dashboard config and the Firebase config of the iOS, Android and
  Flutter examples, registering the apps if the project has none;
- makes your email an admin of the `default` workspace (creating the account
  and printing a password setup link if needed).

You need the Firebase CLI (`firebase login`). The project checks and the admin
step also need `gcloud` signed in (`gcloud auth login` and
`gcloud auth application-default login`); without it, the checks print console
links instead and the admin step tells you what to run.

Nothing it writes is committed: `.clayver/` (the project choice and the dashboard config),
`firebase/functions/.env.<project>`, the example config
files and `examples/android/local.properties` are git-ignored, and local changes
to `examples/flutter/lib/firebase_options.dart` are hidden with
`git update-index --skip-worktree` (undo with `--no-skip-worktree`).

These commands are for working on Clayver. To add Clayver to an app, run
`npx clayver init` in that app.

## Trying `clayver init` before it is published

```bash
pnpm cli:link        # builds the CLI with the dashboard and functions, then `npm link`
cd ~/path/to/some-app
clayver init         # what `npx clayver init` will run once the package is on npm
```

Use an app outside this repository (a new Xcode, Android Studio or Flutter
project, or a copy of an example): `init` writes `clayver.json`, `firebase.json`,
the rules, `clayver-functions/` and `clayver-dashboard/` into it. Remove the link
with `npm unlink -g clayver`.

## Firebase Emulator Suite (rules, storage, functions)

Requires Java 11+ and the workspace dependencies (`pnpm install`).

```bash
pnpm test:emulators
```

This builds `firebase/functions` and starts the Auth, Database, Storage and
Functions emulators for the demo project `demo-clayver`. It then runs three
suites in `firebase/tests/src`:

| Suite | Covers |
| --- | --- |
| `rules.test.ts` | Unauthenticated access, customer isolation (anonymous and signed-in users, stale `clayver_cid` claims ignored), conversation creation, sender spoofing, message immutability and validation, attachment metadata, role escalation, config, customer properties, read markers, device registrations, workspace boundaries |
| `storage.test.ts` | Attachment ownership by uid, agent access via the role claim, content type and size limits, immutability |
| `functions.test.ts` | Customer identity (uid as customer id, recorded account, impersonation, multi-device), bootstrap and role management (escalation, invites, revocation, last admin), message fan-out, statuses, paging, **concurrent messaging and unread counts**, welcome message, push fan-out, de-duplication, preferences, assignee routing, invalid tokens, **token refresh and token moving between users** |

FCM cannot be emulated. When the functions run under the emulator with
`CLAYVER_EMULATOR_FCM_SINK=true` (set in `firebase/functions/.env.demo-clayver`),
pushes are written to `clayverEmulator/pushes`, and tokens starting with
`invalid-` fail like unregistered tokens. This switch is ignored outside the
Functions emulator.

## Unit tests

```bash
pnpm test                                   # Turborepo: core, dashboard, CLI
cd flutter && flutter test                  # Dart bridge
cd ios && swift test                        # or xcodebuild test (macOS)
cd android && ./gradlew :clayver:testDebugUnitTest
```

## Changing the rules

`firebase/database.rules.json` is generated. Edit
`firebase/scripts/build-database-rules.mjs`, then run
`pnpm --filter @clayver/functions rules:build` and the emulator tests.
