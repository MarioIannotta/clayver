/** Storage rules for attachments: ownership, agent access via claims, size and type limits. */
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { BASE, testEnv } from "./env";

let env: Awaited<ReturnType<typeof testEnv>>;
const path = (cid: string, file = "photo.png", att = "att-1") => `${BASE}/customers/${cid}/conversations/c1/${att}/${file}`;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const customer = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } });
const staleClaim = (uid: string, cid: string) => env.authenticatedContext(uid, { clayver_cid: cid });
const agent = (uid: string, role = "agent", ws = "default") => env.authenticatedContext(uid, { clayver_roles: { [ws]: role } });

beforeAll(async () => {
  env = await testEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(path("cust1", "existing.png")).put(png, { contentType: "image/png" });
  });
});

describe("attachments", () => {
  it("a customer uploads and reads within their own folder", async () => {
    const s = customer("cust1").storage();
    await assertSucceeds(s.ref(path("cust1")).put(png, { contentType: "image/png" }).then());
    await assertSucceeds(s.ref(path("cust1", "existing.png")).getMetadata());
  });

  it("a customer cannot touch another customer's folder", async () => {
    const s = customer("cust2").storage();
    await assertFails(s.ref(path("cust1", "x.png")).put(png, { contentType: "image/png" }).then());
    await assertFails(s.ref(path("cust1", "existing.png")).getMetadata());
    await assertFails(s.ref(path("cust1", "existing.png")).getDownloadURL());
  });

  it("customers use their uid, whatever claims the token carries", async () => {
    const s = staleClaim("phoneUid", "v_alice").storage();
    await assertSucceeds(s.ref(path("phoneUid")).put(png, { contentType: "image/png" }).then());
    await assertFails(s.ref(path("v_alice")).put(png, { contentType: "image/png" }).then());
  });

  it("agents read and upload with the role claim, for their workspace only", async () => {
    await assertSucceeds(agent("agentA").storage().ref(path("cust1", "existing.png")).getMetadata());
    await assertSucceeds(agent("adminA", "admin").storage().ref(path("cust1", "reply.jpg")).put(png, { contentType: "image/jpeg" }).then());
    await assertFails(agent("other", "agent", "other-ws").storage().ref(path("cust1", "existing.png")).getMetadata());
    await assertFails(env.authenticatedContext("plainUser").storage().ref(path("cust1", "existing.png")).getMetadata());
    await assertFails(env.unauthenticatedContext().storage().ref(path("cust1", "existing.png")).getMetadata());
  });

  it("rejects disallowed content types and oversized files", async () => {
    const s = customer("cust1").storage();
    await assertFails(s.ref(path("cust1", "run.exe")).put(png, { contentType: "application/x-msdownload" }).then());
    await assertFails(s.ref(path("cust1", "page.html")).put(png, { contentType: "text/html" }).then());
    await assertFails(s.ref(path("cust1", "doc.pdf")).put(png, { contentType: "application/pdf" }).then());
    const big = new Uint8Array(300 * 1024 + 1);
    await assertFails(s.ref(path("cust1", "big.png")).put(big, { contentType: "image/png" }).then());
    await assertFails(s.ref(path("cust1", "photo.png", "bad id!")).put(png, { contentType: "image/png" }).then());
  });

  it("attachments are immutable", async () => {
    const s = customer("cust1").storage();
    await assertFails(s.ref(path("cust1", "existing.png")).put(png, { contentType: "image/png" }).then());
    await assertFails(s.ref(path("cust1", "existing.png")).delete());
    await assertFails(agent("adminA", "admin").storage().ref(path("cust1", "existing.png")).delete());
  });

  it("nothing outside the Clayver prefix is granted", async () => {
    await assertFails(customer("cust1").storage().ref("public/file.png").put(png, { contentType: "image/png" }).then());
  });
});
