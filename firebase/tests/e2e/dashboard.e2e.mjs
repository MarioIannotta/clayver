// Browser end-to-end check of the dashboard against the emulators: sign in, claim admin (default tags seeded),
// saved replies and rate limits in Settings, tag a conversation, create a tag from the picker, filter the inbox
// by tag, internal note, insert a saved reply, reply, real-time update, the customer's other conversation,
// block / unblock (manual and automatic), close, export and delete the customer.
// Usage (from firebase/tests, after `pnpm build`): firebase emulators:exec --project demo-clayver --only auth,database,storage,functions \
//   "node ../scripts/load-emulator-rules.mjs && node e2e/dashboard.e2e.mjs <screenshot dir> <dir with clayver.config.json>"
// Needs playwright-core and firebase-admin installed next to it, and a Chromium build.
import { chromium } from "playwright-core";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase, ServerValue } from "firebase-admin/database";
import { spawn } from "node:child_process";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
const app = initializeApp({ projectId: "demo-clayver", databaseURL: "http://127.0.0.1:9000?ns=demo-clayver" });
const db = getDatabase(app);
const BASE = "clayver/projects/default";
const shots = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); } throw new Error("timeout"); };

await getAuth(app).createUser({ email: "owner@example.com", password: "correct-horse-battery", emailVerified: true, displayName: "Owner" });
// A customer conversation, as the SDK would write it (functions fill the rest).
const conv = db.ref(`${BASE}/conversations`).push();
await conv.set({ customerId: "custE2E", status: "open", createdAt: ServerValue.TIMESTAMP });
await db.ref(`${BASE}/users/custE2E/properties`).set({ _name: "Ada Customer", plan: "premium" });
await db.ref(`${BASE}/messages/${conv.key}`).push({ senderId: "custE2E", senderType: "customer", text: "My order never arrived", createdAt: ServerValue.TIMESTAMP });
// A second conversation of the same customer, shown in the customer panel.
await sleep(50);
const conv2 = db.ref(`${BASE}/conversations`).push();
await conv2.set({ customerId: "custE2E", status: "open", createdAt: ServerValue.TIMESTAMP });
await db.ref(`${BASE}/messages/${conv2.key}`).push({ senderId: "custE2E", senderType: "customer", text: "Do you ship to Canada?", createdAt: ServerValue.TIMESTAMP });
const val = async (path) => (await db.ref(`${BASE}/${path}`).get()).val();
const check = (cond, what) => { if (!cond) throw new Error(`check failed: ${what}`); console.log("OK", what); };
let failed = false;

const server = spawn("node", [new URL("../../../packages/setup/dist/cli.js", import.meta.url).pathname, "dashboard", "start", "--dir", process.argv[3], "--port", "5390"], { stdio: "inherit" });
await sleep(1500);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const step = async (name) => { await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); console.log("STEP", name); };
try {
  await page.goto("http://localhost:5390/");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await step("1-signin");
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.getByText("Setting up Clayver for the first time?").click({ timeout: 15000 });
  await page.getByRole("button", { name: /claim admin/i }).click({ timeout: 15000 });
  await step("2-claimed");

  // Claiming the first admin seeds the default tags; they show in the inbox tag filter.
  await until(async () => Object.keys((await val("tags")) ?? {}).length >= 10);
  const tagFilter = page.getByLabel("Tag", { exact: true });
  await until(async () => (await tagFilter.locator("option").allTextContents()).includes("Waiting on customer"));
  check((await val("tags/to-do"))?.name === "To do", "default tags seeded and listed in the inbox filter");

  // Settings: default tags listed, add a saved reply, set rate limits.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Tags" }).waitFor();
  await page.getByText("Feature request").first().waitFor();
  await page.getByRole("button", { name: "New saved reply" }).click();
  await page.getByLabel("Title").fill("Shipping times");
  await page.getByLabel("Text", { exact: true }).fill("We ship within 2 business days.");
  await page.getByRole("button", { name: "Add saved reply" }).click();
  await page.locator(".saved-reply-row").getByText("Shipping times").waitFor();
  await until(async () => Object.values((await val("savedReplies")) ?? {}).some((r) => r.title === "Shipping times"));
  await page.getByLabel("Messages per minute").fill("20");
  await page.getByRole("button", { name: "Save limits" }).click();
  await until(async () => (await val("config/private/rateLimits"))?.messagesPerMinute === 20);
  check(true, "saved reply created and rate limits saved from Settings");
  await step("2b-settings");

  await page.getByRole("link", { name: "Inbox" }).click();
  await page.getByText("My order never arrived").first().click({ timeout: 20000 });
  await page.getByText("Ada Customer").first().waitFor({ timeout: 10000 });
  await step("3-conversation");

  // The customer's other conversation is listed in the customer panel.
  const panel = page.locator("#customer-panel");
  await panel.getByText("Other conversations (1)").waitFor({ timeout: 10000 });
  await panel.getByText("Do you ship to Canada?").waitFor();
  check(true, "second conversation of the same customer in the customer panel");

  // Tag the conversation with an existing tag from the picker.
  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await page.getByLabel("Search tags").fill("urg");
  await page.locator(".tag-picker").getByRole("option", { name: /Urgent/ }).click();
  await until(async () => (await val(`conversationTags/${conv.key}/urgent`)) === true);
  await until(async () => typeof (await val(`tagIndex/urgent/${conv.key}`)) === "string");
  // Create a new tag from the picker: it gets the slug id and is added to the conversation.
  await page.getByLabel("Search tags").fill("VIP customer");
  await page.locator(".tag-picker").getByRole("option", { name: "Create tag “VIP customer”" }).click();
  await until(async () => (await val(`conversationTags/${conv.key}/vip-customer`)) === true);
  const vip = await val("tags/vip-customer");
  check(vip?.name === "VIP customer" && /^#[0-9A-F]{6}$/.test(vip.color), "tag created from the picker with a slug id and palette color");
  await step("3b-tag-picker");
  await page.keyboard.press("Escape");
  await page.locator(".conversation__tags").getByText("VIP customer").waitFor();
  check(true, "conversation tagged (Urgent, VIP customer)");

  // Filter the inbox by tag: only the tagged conversation is listed, and the URL carries the filter.
  await tagFilter.selectOption({ label: "Urgent" });
  await page.waitForURL(/[?&]tag=urgent/);
  const list = page.locator("#conversation-list");
  await list.getByText("My order never arrived").waitFor();
  await until(async () => (await list.getByText("Do you ship to Canada?").count()) === 0);
  await list.locator(".tag-chip", { hasText: "Urgent" }).first().waitFor();
  check(true, "inbox filtered by tag via tagIndex, reflected in the URL");
  await step("3c-tag-filter");

  // Internal note: shown inline in the timeline, never written as a message.
  await page.getByRole("button", { name: "Internal note" }).click();
  await page.getByPlaceholder(/Write an internal note/).fill("Customer is a VIP, refund without questions.");
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByText("Internal note · Owner").waitFor({ timeout: 10000 });
  const notes = Object.values((await val(`notes/${conv.key}`)) ?? {});
  const msgsAfterNote = Object.values((await val(`messages/${conv.key}`)) ?? {});
  check(notes.length === 1 && notes[0].text.startsWith("Customer is a VIP") && !msgsAfterNote.some((m) => m.text?.startsWith("Customer is a VIP")), "internal note stored in notes/, not in messages/");
  await step("3d-note");

  // Saved replies: "/" opens the picker, Enter inserts the text.
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const composer = page.getByPlaceholder("Write a reply… Type / for saved replies.");
  await composer.fill("/ship");
  await page.locator(".saved-reply-picker").getByText("Shipping times").waitFor();
  await step("3e-saved-reply-picker");
  await composer.press("Enter");
  check((await composer.inputValue()) === "We ship within 2 business days.", "saved reply inserted with the / shortcut");
  await composer.fill("");
  // ...and from the button, with search.
  await page.getByRole("button", { name: "Saved replies" }).click();
  await page.getByLabel("Search saved replies").fill("ship");
  await page.locator(".saved-reply-picker").getByRole("option", { name: /Shipping times/ }).click();
  check((await composer.inputValue()) === "We ship within 2 business days.", "saved reply inserted from the Saved replies button");
  await composer.fill("Sorry Ada, a replacement ships today.");
  await page.getByRole("button", { name: /^send/i }).click();
  await until(async () => {
    const msgs = Object.values((await db.ref(`${BASE}/messages/${conv.key}`).get()).val() ?? {});
    return msgs.find((m) => m.senderType === "agent" && m.text.startsWith("Sorry Ada"));
  });
  const inbox = await until(async () => (await db.ref(`${BASE}/inbox/custE2E/unreadTotal`).get()).val() === 1).catch(async (e) => {
    console.log("INBOX", JSON.stringify((await db.ref(`${BASE}/inbox`).get()).val()), JSON.stringify((await db.ref(`${BASE}/conversations/${conv.key}`).get()).val()));
    throw e;
  });
  console.log("REPLY_PERSISTED customer unreadTotal=1", inbox);
  // Customer answers in real time (as the SDK would) and it appears without reload.
  await db.ref(`${BASE}/messages/${conv.key}`).push({ senderId: "custE2E", senderType: "customer", text: "Thank you!", createdAt: ServerValue.TIMESTAMP });
  await page.getByText("Thank you!").waitFor({ timeout: 15000 });
  await step("4-realtime");

  // Block (reason + duration), then unblock.
  await panel.getByRole("button", { name: "Block…" }).click();
  await panel.getByLabel("Reason").selectOption("abuse");
  await panel.getByLabel("Duration").selectOption({ label: "24 hours" });
  await panel.getByRole("button", { name: "Block customer" }).click();
  await panel.getByText("Blocked: Abuse").waitFor({ timeout: 10000 });
  const block = await val("moderation/custE2E");
  check(block?.blocked === true && block.reason === "abuse" && block.until > Date.now() + 23 * 3600e3, "customer blocked for 24 hours");
  await step("4b-blocked");
  await panel.getByRole("button", { name: "Unblock" }).click();
  await panel.getByText("Not blocked.").waitFor({ timeout: 10000 });
  check((await val("moderation/custE2E")) === null, "customer unblocked");
  // An automatic rate-limit block shows with its end time and can be lifted.
  await db.ref(`${BASE}/moderation/custE2E`).set({ blocked: true, reason: "rate_limit", by: "system", at: ServerValue.TIMESTAMP, until: Date.now() + 10 * 60e3 });
  await panel.getByText("Blocked automatically: Rate limit").waitFor({ timeout: 10000 });
  await panel.getByText(/^Until /).waitFor();
  await step("4c-rate-limit-block");
  await panel.getByRole("button", { name: "Unblock" }).click();
  await until(async () => (await val("moderation/custE2E")) === null);
  check(true, "automatic rate_limit block shown and lifted");
  await page.getByRole("button", { name: /close/i }).first().click();
  await until(async () => (await db.ref(`${BASE}/conversations/${conv.key}/statusOrder`).get()).val()?.startsWith("closed_"));
  console.log("CLOSED ok");
  await step("5-closed");

  // Open the customer's other conversation from the panel.
  await panel.getByText("Do you ship to Canada?").click();
  await page.waitForURL(new RegExp(`/conversations/${conv2.key}`));
  await page.locator(".messages").getByText("Do you ship to Canada?").waitFor();
  check(true, "opened the second conversation from the customer panel");

  // Admin: export the customer's data as JSON.
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Export data" }).click()]);
  const exported = JSON.parse(await (await import("node:fs/promises")).readFile(await download.path(), "utf8"));
  check(exported.conversations.length === 2 && exported.conversations.some((c) => c.tags.includes("urgent") && c.notes.length === 1), `export downloaded (${download.suggestedFilename()})`);

  // Admin: delete the customer's data (typed confirmation), back to the inbox.
  await panel.getByRole("button", { name: "Delete customer data" }).click();
  await panel.getByLabel("Type DELETE to confirm").fill("DELETE");
  await step("5b-delete-confirm");
  await panel.getByRole("button", { name: "Delete permanently" }).click();
  await page.waitForURL(/\/conversations(\?|$)/, { timeout: 20000 });
  await until(async () => (await val(`conversations/${conv.key}`)) === null && (await val(`conversations/${conv2.key}`)) === null && (await val("users/custE2E")) === null);
  check((await val(`notes/${conv.key}`)) === null && (await val(`tagIndex/urgent/${conv.key}`)) === null, "customer deleted with notes and tag index entries");

  await page.goto("http://localhost:5390/settings");
  await page.getByRole("heading", { name: "Rate limits" }).waitFor();
  await page.waitForTimeout(800);
  await step("6-settings");
  await page.goto("http://localhost:5390/team");
  await page.waitForTimeout(1500);
  await step("7-team");
  console.log("E2E_OK");
} catch (e) {
  failed = true;
  console.log("E2E_FAIL", e.message);
  await step("fail");
} finally {
  await browser.close();
  server.kill("SIGKILL");
  process.exit(failed ? 1 : 0);
}
