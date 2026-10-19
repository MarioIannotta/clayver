# Production checklist

Go through this list before you ship an app with Clayver to real customers.
Clayver runs entirely in **your** Firebase project, so you own its security
settings, its bill and its data. Each item says where to change it.

Commands assume you ran `npx clayver init` in your app directory, so
`clayver.json`, `clayver-functions/` and `clayver-dashboard/` exist there.
Data paths are relative to `clayver/projects/{workspace}/` in the Realtime
Database; see [firebase/database.schema.md](../firebase/database.schema.md).

Items marked **Not yet implemented** describe a gap in the current version and
what to do instead.

## 1. Billing

- [ ] **The project is on the Blaze plan.** Cloud Functions and Secret
  Manager require it; `init` checks it when `gcloud` is available.
- [ ] **Budget alerts are set.** Google Cloud console → Billing → Budgets &
  alerts → Create budget for this project, with email alerts at 50 %, 90 % and
  100 % of an amount you expect. Budgets alert, they do not cap spending.
- [ ] You know the main cost drivers: Realtime Database downloads (every
  open chat and unread badge listens), Storage downloads of attachments,
  and Cloud Functions invocations (one or more per message, read marker and
  device registration).

## 2. Identity

- [ ] **Firebase Auth sign-in methods** your app uses are enabled, plus
  **Anonymous** unless you set `signInAnonymously: false` (then only signed-in
  users can chat). See [identity.md](identity.md).
- [ ] **Your app calls `Clayver.logout()` before signing the user out**, so a
  signed-out phone stops receiving that user's notifications.
- [ ] **Agents use accounts you control.** Anyone you grant a role can read
  every conversation in the workspace; review the Team page and revoke roles
  people no longer need.
- [ ] After the first admin has claimed the workspace, consider emptying
  `CLAYVER_BOOTSTRAP_ADMINS` (bootstrap only works while the workspace has no
  admin, so this is tidying, not a hole).

## 3. App Check

[App Check](https://firebase.google.com/docs/app-check) rejects requests that
do not come from your genuine apps, which limits scripted abuse of anonymous
sign-in, the database and the functions. Roll it out in this order: clients
first, watch the metrics, then enforce.

- [ ] **Mobile apps register an App Check provider** through the Firebase SDK
  in your app (the Clayver SDKs do not configure App Check themselves; the
  Firebase SDKs attach the token to Database, Storage and Functions requests
  once your app has initialised App Check):
  - iOS: **App Attest** (iOS 14+), with **DeviceCheck** as fallback.
  - Android: **Play Integrity**.
  - Flutter: `firebase_app_check` with the same providers.
  Register each app in Firebase console → App Check → Apps, and use the debug
  provider for simulators and CI.
- [ ] **The dashboard uses reCAPTCHA Enterprise.** Create a reCAPTCHA
  Enterprise key for the dashboard's domain, register the dashboard web app in
  App Check, and add `"appCheck": { "recaptchaEnterpriseSiteKey": "<key>" }` to
  `clayver-dashboard/clayver.config.json`. See
  [dashboard/README.md](../dashboard/README.md#app-check). Without it, the
  dashboard stops working as soon as you enforce App Check below.
- [ ] **Watch the request metrics** (App Check → APIs) until almost all
  requests are verified. Old app versions without App Check will be locked
  out once you enforce.
- [ ] **Enforce on the Realtime Database and Storage**: Firebase console →
  App Check → APIs → Realtime Database / Cloud Storage → Enforce.
- [ ] **Enforce on Clayver's callable functions**: add
  `CLAYVER_ENFORCE_APP_CHECK=true` to `clayver-functions/.env.<project>` and
  redeploy (`npx clayver update`, or
  `firebase deploy --only functions:clayver`). The functions read it at deploy
  time and set `enforceAppCheck` on every callable (`clayverBootstrapAdmin`,
  `clayverSetAgentRole`, `clayverDeleteMyData`, `clayverDeleteCustomer`,
  `clayverExportCustomer`). Background functions are
  not affected.
  **Not yet implemented in the CLI:** `init` does not write this key and
  `update` regenerates the `.env` file from the keys it knows. When `update`
  shows a diff that drops the line, decline it (or add the line back) before
  deploying.

## 4. Backups and retention

- [ ] **Realtime Database daily backups are on** (Blaze only): Firebase
  console → Realtime Database → Backups → enable automated backups to a
  Cloud Storage bucket. Test a restore into a separate database instance once.
- [ ] **The backup bucket has a lifecycle rule** that deletes old backups (for
  example after 30 days), so you neither pay for nor keep personal data
  longer than your retention policy allows. Data deleted with
  `clayverDeleteMyData`/`clayverDeleteCustomer` survives in backups until they
  expire; say so in your privacy policy.
- [ ] **Decide on attachment retention.** Clayver never deletes attachments
  on its own (they are immutable; only customer deletion removes a
  customer's folder `clayver/projects/{workspace}/customers/{customerId}/`).
  To cap retention, add an
  [Object Lifecycle](https://cloud.google.com/storage/docs/lifecycle) rule on
  the bucket with `matchesPrefix: ["clayver/projects/"]` and an `age`
  condition. Messages keep pointing at deleted files, which then fail to load.
  **Not yet implemented:** there is no message retention or automatic
  expiry of old conversations.

## 5. API keys

Firebase API keys are public identifiers, not secrets, but unrestricted keys
can be used from anywhere to sign up anonymous users or call Firebase APIs.
Google Cloud console → APIs & Services → Credentials:

- [ ] **iOS key**: Application restrictions → iOS apps → your bundle id(s).
- [ ] **Android key**: Android apps → package name plus the SHA-1 of your
  release signing key **and** of the Play App Signing key (Play Console →
  App integrity), and your debug SHA-1 only on a development project.
- [ ] **Browser key** (used by the dashboard): HTTP referrers →
  `https://<your dashboard domain>/*`, `https://<project>.web.app/*`,
  `https://<project>.firebaseapp.com/*` (Auth's sign-in handler) and, if you
  run `npm start` against production, `http://localhost:5173/*`.
- [ ] If you add API restrictions, keep the Firebase APIs the clients use
  (Identity Toolkit, Token Service, Firebase Installations, FCM Registration,
  Firebase App Check). Test sign-in, chat and push after every change.

## 6. Dashboard hosting

- [ ] **Served over HTTPS only.** `npm run deploy` in `clayver-dashboard/`
  publishes it to Firebase Hosting (`https://<project>.web.app`, HTTPS by
  default); add a custom domain in Hosting if you like. Self-hosting is
  documented in [dashboard/README.md](../dashboard/README.md); any static host
  works as long as it serves HTTPS, falls back to `index.html` for client
  routes, and serves `clayver.config.json` next to `index.html`.
- [ ] **Auth authorized domains** (Firebase console → Authentication →
  Settings → Authorized domains) list exactly the dashboard's domains.
  Google sign-in fails elsewhere; remove domains you no longer use.
- [ ] **`CLAYVER_DASHBOARD_URL`** in `clayver-functions/.env.<project>` is the
  dashboard's public URL, so web push notifications open the right page.
  Set it yourself when the dashboard runs on a custom domain, then redeploy
  the functions.
- [ ] Browser notifications for agents need a web push certificate: Firebase
  console → Project settings → Cloud Messaging → Web Push certificates, then
  `"vapidKey"` in `clayver.config.json`.

## 7. Firebase Authentication

- [ ] **Email enumeration protection is on** (Authentication → Settings →
  User actions). It is on by default for projects created since
  September 2023; check older projects.
- [ ] **Only the providers you use are enabled.** Clayver needs
  **Anonymous** (the SDKs sign customers in anonymously when your app has no
  Firebase user) and, for agents, **Email/Password** and/or **Google**.
  Disable everything else.
- [ ] Agents' accounts carry no rights until an admin grants a role, but if
  agents use email/password, consider disabling self sign-up (Authentication
  → Settings → User actions → uncheck "Enable create (sign-up)") once your
  team exists; new agents are then created with
  `clayver admin grant --email <e> --role agent --create`.
  Leave sign-up on if your own app creates Firebase users from the client.
- [ ] Anonymous users accumulate. If you upgrade to Firebase Authentication
  with Identity Platform, automatic clean-up deletes anonymous accounts after
  30 days; their Clayver data stays (customer id = the anonymous uid) and
  becomes unreachable. Have customers whose history matters sign in, and link
  the anonymous user when they sign up (see [identity.md](identity.md)).

## 8. Abuse: rate limits and blocking

- [ ] **Rate limits fit your app.** Clayver blocks a customer automatically
  for 10 minutes above `messagesPerMinute` (default 30) and for 1 hour above
  `conversationsPerHour` (default 10). Admins change them in the dashboard or
  in `config/private/rateLimits` (`{ messagesPerMinute, conversationsPerHour }`,
  each 1-1000). See `moderation` in
  [the data model](../firebase/database.schema.md#moderationcustomerid).
- [ ] **Agents know how to block.** A manual block
  (`moderation/{customerId}`, reasons `spam`, `abuse`, `other`) stops the
  customer from creating conversations and messages until it expires or an
  agent removes it; the customer keeps read access to their history and the
  SDK shows "You can't send messages right now". Automatic `rate_limit`
  blocks never replace a manual one.
- [ ] App Check (section 3) is the main defence against scripted accounts;
  rate limits only slow down one customer id at a time.

## 9. Data export and deletion (GDPR, App Store account deletion)

- [ ] **Your app's account deletion flow calls `deleteCustomerData()`**
  (all SDKs; it calls `clayverDeleteMyData` and logs out). Apple requires
  in-app account deletion (App Store Review Guideline 5.1.1(v)) and Google
  Play requires a deletion path too. Call it before you delete the user in
  your own backend or Firebase Auth, while the app is still signed in as that
  user.
- [ ] **You can answer access and erasure requests.** Admins export a
  customer's data as JSON with `clayverExportCustomer` and erase it with
  `clayverDeleteCustomer` (both admin-only callables, also available from the
  customer panel of the dashboard). The customer id is the user's Firebase
  uid.
- [ ] Deletion removes the customer's profile, inbox, moderation and limits,
  device registrations, every conversation they own (messages, read markers,
  tags, notes) and their Storage folder. It does not touch backups (see
  section 4) or Cloud Functions logs; keep log retention short if logs could
  contain personal data.
- [ ] Check that your deployed functions include these callables:
  `npx clayver status --remote` lists the deployed Clayver functions. If they
  are missing, upgrade (section 13).

## 10. Push notifications

See [push-notifications.md](push-notifications.md) for the full setup.

- [ ] **iOS: an APNs authentication key** (.p8) is uploaded in Firebase
  console → Project settings → Cloud Messaging → Apple app configuration,
  with the right Key ID and Team ID. One key covers development and
  production. The app has the Push Notifications capability and Background
  Modes → Remote notifications.
- [ ] **Android: FCM works** with your release `google-services.json`, and
  Android 13+ asks for `POST_NOTIFICATIONS`.
- [ ] **Verify end to end on a release build**: sign in as a customer, send a
  message, check that a registration appears under
  `devices/customers/{customerId}`, reply from the dashboard with the app in
  the background, and tap the notification (it should open that
  conversation). Repeat for an agent device if you use agent mode.
- [ ] Watch the functions logs for failed sends after launch; invalid tokens
  are deactivated automatically and stale registrations are pruned daily
  after 270 days.

## 11. Monitoring

- [ ] **Logs**: Firebase console → Functions → Logs, or
  `firebase functions:log --project <project>`. Clayver's functions are 2nd
  gen (Cloud Run), so they also appear in Cloud Logging under
  `resource.type="cloud_run_revision"`.
- [ ] **Error Reporting** (Google Cloud console → Error Reporting) groups
  uncaught function errors; turn on notifications for new error groups.
- [ ] **An alert on function errors**: in Cloud Monitoring, create a
  log-based alert on
  `resource.type="cloud_run_revision" AND severity>=ERROR AND resource.labels.service_name=~"^clayver"`,
  or an alert on the Cloud Run request count with response code class `5xx`.
- [ ] **Realtime Database usage**: Firebase console → Realtime Database →
  Usage (connections, storage, downloads, load). In Cloud Monitoring, alert on
  `firebasedatabase.googleapis.com/io/database_load` above 0.8 and on
  `network/active_connections` approaching the instance limit.
- [ ] Optional: Crashlytics in your app catches crashes in the SDK UI, and
  the budget alerts (section 1) catch runaway usage.

## 12. Scaling

- [ ] **Know the Realtime Database limits per instance**: about 200,000
  simultaneous connections and about 1,000 write operations per second (see
  [Realtime Database limits](https://firebase.google.com/docs/database/usage/limits)).
  Every app session that shows the unread badge or an open chat holds a
  connection.
- [ ] Functions scale automatically; each customer message causes a few
  function invocations (fan-out, unread counters, push). Watch database load
  rather than function count.
- [ ] **Sharding across several database instances is not yet implemented.**
  The SDK and dashboard accept a `databaseURL` option, but Clayver's Cloud
  Functions read and write the project's **default** instance only, so keep
  `databaseURL` unset (or pointing at the default instance). If you outgrow
  one instance, use separate Firebase projects (for example one per app or
  region), each with its own Clayver installation.

## 13. Upgrading Clayver

- [ ] **Backend**: `npx clayver@latest update` copies the rules and functions
  of the new CLI version into your project, shows every change as a diff and
  redeploys (`--dry-run` first to see the plan). Check `CLAYVER_*` lines in
  `clayver-functions/.env.<project>` survive (section 3).
- [ ] **Dashboard**: update the `clayver` devDependency in
  `clayver-dashboard/package.json` to the same version, `npm install`, then
  `npm run deploy`.
- [ ] **Apps**: bump the iOS, Android and Flutter SDKs to the same version
  (all Clayver packages share one version). Deploy the backend first: new
  SDKs may rely on new rules or functions. Test the app versions your
  customers still run against the upgraded backend (the emulator suite or a
  staging project) before you deploy to production.
- [ ] Read [CHANGELOG.md](../CHANGELOG.md) for breaking changes; before 1.0 a
  minor version (0.x.0) may contain them.
- [ ] `npx clayver status` shows whether your installed files are edited,
  missing or older than the CLI's bundle.
