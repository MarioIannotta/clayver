# Clayver dashboard

The web inbox your support team uses to answer customers. It is a static
single-page app (React + Vite) that talks directly to **your** Firebase project:
Realtime Database, Storage, Auth, Cloud Functions and Cloud Messaging. There is
no Clayver server, so you can host it anywhere that serves static files.

Features:

- Sign in with email/password or Google. Signed-in users without a role see a
  "not an agent" screen; the first admin can claim the role there.
- Inbox with Open / Closed tabs, priority, status and tag filters (kept in the
  URL, e.g. `/conversations?priority=high&tag=bug`), unread counts, tag chips and
  live updates.
- Conversation view with history pagination, replies with photos (compressed to a
  JPEG of at most 300 KB before upload), image previews, "Seen" read receipts, open/close,
  assign to me, priority (low / medium / high) and status (to do / in progress /
  on hold), and a customer details panel (`users/{cid}/properties`).
- Tags: add, remove and create tags from the Tags box next to Priority and
  Status in the conversation header; rename and recolor them in Settings
  (admins can delete a tag, which removes it from every conversation).
- Internal notes: written and listed in the side panel, visible to the team
  only and never sent to the customer.
- Saved replies: team-shared canned answers managed in Settings; type `/` at the
  start of the composer or click **saved replies** in the hint under it.
- Customer panel: the customer's other conversations, block / unblock (spam,
  abuse or other; 1 hour, 24 hours or permanent; automatic rate-limit blocks show
  with their end time) and, for admins, **Export data** (JSON download) and
  **Delete customer data**.
- Settings: every agent can change their display name. Admins also get the
  anonymous sign-in switch (whether visitors can chat without an account) and
  the automatic rate limits (messages per minute, conversations per hour).
- Team page for admins: add agents or admins by email (shows the invite link for
  new accounts), grant a role to an **app user id** so that person can answer
  from inside your mobile app (one row per person, with their device count),
  change roles, revoke.
- Browser push notifications that open the conversation when clicked.

The data model it relies on is documented in
[`firebase/database.schema.md`](../firebase/database.schema.md). The data-access
layer lives in [`@clayver/core`](../packages/core), which you can reuse to build
your own dashboard.

## Quick start (from your app)

The `clayver` npm package ships this dashboard prebuilt. In your app, after
`npx clayver init`:

```sh
cd clayver-dashboard
npm install
npm start          # http://localhost:5173
npm run deploy     # optional: Firebase Hosting, https://<project>.web.app
```

`init` registers a Firebase **web app** for the dashboard and writes
`clayver-dashboard/clayver.config.json`, so there is nothing to fill in.
`npx clayver dashboard start` also works without the folder when it runs in a
directory with `clayver.json` (it then reads the web config from your Firebase
project). See the [CLI README](../packages/setup/README.md#clayver-dashboard-start).

Before the first sign-in, make sure the backend is deployed (`init` does it),
Email/Password (and optionally Google) sign-in is enabled, and you have an admin:
`npx clayver admin grant --email you@example.com --role admin`. Google sign-in
works on `localhost` and `<project>.web.app` out of the box; add any other domain
you host the dashboard on to Auth > Settings > Authorized domains.

## Configuration

The dashboard reads its configuration **when it starts**, not when it is built,
so one build works for every Firebase project. It tries, in order:

1. `clayver.config.json` next to `index.html` (same origin, fetched with `no-store`),
2. Firebase Hosting's reserved `/__/firebase/init.json` (the hosting project's
   default web app) plus the defaults below,
3. `VITE_*` variables inlined at build time (for developing the dashboard itself).

The Firebase web config comes from the first source that has one; the other
fields fall back field by field (file, then build-time values, then defaults).

```json
{
  "firebase": {
    "apiKey": "AIza...",
    "authDomain": "my-app.firebaseapp.com",
    "databaseURL": "https://my-app-default-rtdb.firebaseio.com",
    "projectId": "my-app",
    "storageBucket": "my-app.firebasestorage.app",
    "messagingSenderId": "1234567890",
    "appId": "1:1234567890:web:abc123"
  },
  "projectId": "default",
  "functionsRegion": "us-central1",
  "vapidKey": ""
}
```

| Field | Required | Build-time variable | Notes |
| --- | --- | --- | --- |
| `firebase.apiKey`, `authDomain`, `projectId`, `databaseURL`, `storageBucket`, `appId` | yes | `VITE_FIREBASE_API_KEY`, `..._AUTH_DOMAIN`, `..._PROJECT_ID`, `..._DATABASE_URL`, `..._STORAGE_BUCKET`, `..._APP_ID` | The web app config (`firebase apps:sdkconfig WEB <appId>`). `databaseURL` is `...firebasedatabase.app` for non-US instances. |
| `firebase.messagingSenderId` | for push | `VITE_FIREBASE_MESSAGING_SENDER_ID` | |
| `projectId` | no | `VITE_CLAYVER_PROJECT_ID` | Clayver workspace, default `default`. |
| `functionsRegion` | no | `VITE_CLAYVER_FUNCTIONS_REGION` | Default `us-central1`. |
| `vapidKey` | for push | `VITE_FIREBASE_VAPID_KEY` | Web push public key (Project settings > Cloud Messaging > Web Push certificates > Generate key pair). Empty hides notifications. |
| `useEmulators` | no | `VITE_USE_EMULATORS` | `true` connects to the Local Emulator Suite. |
| `emulatorHost` | no | `VITE_EMULATOR_HOST` | Default `127.0.0.1`. |
| `appCheck.recaptchaEnterpriseSiteKey` | no | `VITE_CLAYVER_APP_CHECK_SITE_KEY` | Turns on [Firebase App Check](#app-check) with reCAPTCHA Enterprise. |

These values are public web configuration, not secrets: access is enforced by the
Clayver security rules and by the role table.

### App Check

If your project enforces [Firebase App Check](https://firebase.google.com/docs/app-check)
for Realtime Database, Storage or Cloud Functions, give the dashboard a
reCAPTCHA Enterprise site key:

```json
{
  "firebase": { "...": "..." },
  "appCheck": { "recaptchaEnterpriseSiteKey": "6Lc..." }
}
```

1. In the Google Cloud console, create a reCAPTCHA Enterprise **website** key
   for the domains you host the dashboard on (add `localhost` for `npm start`).
2. In the Firebase console, App Check > Apps, register the dashboard's web app
   with the reCAPTCHA Enterprise provider and that site key.
3. Add the `appCheck` block above to `clayver.config.json`.

When the field is set, the dashboard initialises App Check with
`ReCaptchaEnterpriseProvider` (token auto-refresh on) right after the Firebase
app and before Auth, Database, Storage and Functions, so every request carries
an App Check token. Without it, App Check is not initialised. A malformed
`appCheck` block (for example a missing `recaptchaEnterpriseSiteKey`) is listed
on the "not configured" page. To run against the emulators or on a host that
is not registered for the key, use an
[App Check debug token](https://firebase.google.com/docs/app-check/web/debug-provider)
or leave the field out.

If something required is missing, the dashboard shows a "not configured" page
listing what is missing (and where it looked) instead of failing silently.

Builds are environment-independent unless you set `VITE_*` variables. Every
build writes `dist/build-info.json`; the `clayver` CLI refuses to bundle a build
that has project config inlined (`"embeddedConfig": true`).

## Local development

From the repository root:

```sh
pnpm install
cp dashboard/.env.example dashboard/.env.local   # then edit it (or put a clayver.config.json in dashboard/public/)
pnpm --filter @clayver/dashboard dev             # http://localhost:5173
```

`@clayver/core` is consumed from source in dev and build, so you do not need to
build it first.

Other scripts:

```sh
pnpm --filter @clayver/dashboard build      # typecheck + production build into dashboard/dist
                                            # (do not keep a .env.local around when building the CLI package)
pnpm --filter @clayver/dashboard preview    # serve dashboard/dist on :4173
pnpm --filter @clayver/dashboard typecheck
```

### Emulator mode

Start the emulators from the `firebase/` folder (`firebase emulators:start`), then:

```sh
pnpm --filter @clayver/dashboard dev:emulators
```

This sets `VITE_USE_EMULATORS=true` (or put `"useEmulators": true` in a
`clayver.config.json`), which connects Auth (9099), Realtime
Database (9000), Storage (9199) and Functions (5001), the ports in
`firebase/firebase.json`. In emulator mode only `VITE_FIREBASE_PROJECT_ID` is
required (it defaults to `demo-clayver`); it must match the project the emulators
run as. Create a user in the Auth emulator (with a verified email), list its email in the
`CLAYVER_BOOTSTRAP_ADMINS` function parameter, sign in and use **Claim admin**.
Web push is not available against the emulators.

## Becoming the first admin

Roles are stored in `clayver/projects/{projectId}/agents/{uid}` and only Cloud
Functions can write them. To create the first admin, either:

- run `npx clayver admin grant --email <email> --role admin` with the setup CLI, or
- set the `CLAYVER_BOOTSTRAP_ADMINS` function parameter to your email, sign in to
  the dashboard and click **Claim admin** on the "not an agent" screen. This only
  works while the workspace has no admin and your email is verified (Google
  sign-in accounts are).

After that, add teammates from the **Team** page. Adding an email that has no
account yet creates one and shows an invite link the new agent uses to set a
password.

### Agents inside your app

Agents are Firebase Auth accounts of the same project, so the account you grant
on the Team page can also sign in to your app and answer conversations from
there through the SDK. The CLI equivalent is
`npx clayver admin grant --email <email> --role agent` (or `--uid <uid>`).
Revoking a role signs that account out on every device.

## Deploying

The simplest way is `npm run deploy` in the `clayver-dashboard/` folder that
`npx clayver init` generated (`clayver dashboard deploy`): it copies the
prebuilt dashboard and `clayver.config.json` into `public/` and deploys it to
Firebase Hosting. The rest of this section is for hosting a build of this
folder yourself.

`pnpm --filter @clayver/dashboard build` produces a static site in
`dashboard/dist`. Every route (for example `/conversations/-Nx...`) must fall
back to `index.html` (an SPA rewrite), and `firebase-messaging-sw.js` must be
served from the site root with no long-lived caching.

### Firebase Hosting

Merge the `hosting` block from [`firebase.hosting.json`](./firebase.hosting.json)
into the `firebase.json` you deploy from (the Clayver setup CLI can add it for
you). `public` is relative to that `firebase.json`; the snippet assumes the
repository's `firebase/firebase.json`, so adjust the path if yours lives
elsewhere.

```json
{
  "hosting": {
    "public": "../dashboard/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

Then:

```sh
pnpm --filter @clayver/dashboard build
cd firebase && firebase deploy --only hosting
```

The `rewrites` rule is the SPA fallback. The full snippet also sets cache headers
(immutable `/assets/**`, `no-cache` for `index.html` and the service worker).
Remember to add your `*.web.app` / custom domain to Auth authorized domains.

To let push notifications link to your dashboard from other surfaces, set the
`CLAYVER_DASHBOARD_URL` function parameter to the deployed URL.

### Netlify

Build command `pnpm --filter @clayver/dashboard build`, publish directory
`dashboard/dist`. The SPA rewrite is already included as
[`public/_redirects`](./public/_redirects) (`/*  /index.html  200`).

Set the `VITE_*` variables in the site's environment settings, or put a
`clayver.config.json` in the publish directory.

### Vercel

Root directory `dashboard`, framework preset "Vite", build command
`pnpm build` (Vercel installs the workspace from the repo root), output
`dist`, and a `vercel.json` with:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

### nginx / any static host

Copy `dashboard/dist` to the web root and route unknown paths to `index.html`.
[`nginx.conf`](./nginx.conf) is a complete server block:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

### Docker

[`Dockerfile`](./Dockerfile) builds the dashboard and serves it with nginx on
port 8080. Either mount a `clayver.config.json` into the web root
(`-v $PWD/clayver.config.json:/usr/share/nginx/html/clayver.config.json:ro`), or
build it from the repository root passing the `VITE_*` values as build args
(they are inlined at build time):

```sh
docker build -f dashboard/Dockerfile -t clayver-dashboard \
  --build-arg VITE_FIREBASE_API_KEY=... \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN=... \
  --build-arg VITE_FIREBASE_PROJECT_ID=... \
  --build-arg VITE_FIREBASE_DATABASE_URL=... \
  --build-arg VITE_FIREBASE_STORAGE_BUCKET=... \
  --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID=... \
  --build-arg VITE_FIREBASE_APP_ID=... \
  --build-arg VITE_FIREBASE_VAPID_KEY=... \
  .
docker run -p 8080:8080 clayver-dashboard
```

### Hosting under a sub-path

To serve the dashboard from e.g. `https://example.com/support/`, build with
`pnpm --filter @clayver/dashboard exec vite build --base=/support/` and route
`/support/*` to `/support/index.html`. Router links, the service worker and its
notification links all follow the base path.

## Browser notifications

Each agent turns notifications on in **Settings**. The dashboard then:

1. registers `firebase-messaging-sw.js` (scope `/firebase-cloud-messaging-push-scope`,
   so it never intercepts page requests),
2. asks for notification permission and obtains an FCM token with your VAPID key,
3. writes `devices/agents/{uid}/{deviceId}` and sets
   `agentSettings/{uid}/notifications/push = true`.

The service worker does not need your Firebase config: it reads the standard
Clayver push payload (`data.clayver == "1"`, `data.conversationId`), shows a
notification when no dashboard tab is visible (or an in-app toast when one is),
and opens `/conversations/{conversationId}` on click. Turning notifications off,
or signing out, marks the registration inactive.

## Troubleshooting

- **"Dashboard not configured"**: the page lists what is missing. With
  `npm start`, check `clayver-dashboard/clayver.config.json`; run
  `npx clayver init` again to regenerate it.
- **"Could not load your role"**: the database rules are not deployed, or
  `firebase.databaseURL` points at another database instance.
- **"You are not an agent"** after being added: make sure `projectId` in
  `clayver.config.json` (or `VITE_CLAYVER_PROJECT_ID`) matches the workspace you
  were added to.
- **Google sign-in fails with `auth/unauthorized-domain`**: add the dashboard's
  domain to Auth > Settings > Authorized domains.
- **Attachments show "unavailable"** right after a role change: ID tokens carry
  the `clayver_roles` claim used by Storage rules; the dashboard refreshes the
  token automatically, but signing out and back in also fixes it.
