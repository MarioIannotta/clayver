// The Functions emulator reads and writes the database namespace named after the
// project ("demo-clayver"), while firebase.json rules are applied to
// "<project>-default-rtdb". Load the rules (and their indexes) into the namespace
// the functions actually use, so local development behaves like production.
import { readFileSync } from "node:fs";

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000";
const ns = process.env.CLAYVER_EMULATOR_NAMESPACE ?? "demo-clayver";
const rules = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
const res = await fetch(`http://${host}/.settings/rules.json?ns=${ns}`, {
  method: "PUT",
  headers: { Authorization: "Bearer owner" },
  body: rules,
});
if (!res.ok) throw new Error(`loading rules into ${ns} failed: ${res.status} ${await res.text()}`);
console.log(`clayver: database rules loaded into emulator namespace ${ns}`);
