import { describe, expect, it } from "vitest";
import { functionsEnvFile, parseEnvFile } from "../src/backend/functions.js";

const base = { projectId: "demo", bootstrapAdmins: ["a@example.com"], region: "europe-west1" };

describe("functions .env file", () => {
  it("writes App Check enforcement off by default", () => {
    const env = parseEnvFile(functionsEnvFile(base));
    expect(env.CLAYVER_ENFORCE_APP_CHECK).toBe("false");
    expect(env.CLAYVER_FUNCTIONS_REGION).toBe("europe-west1");
  });

  it("round-trips the App Check setting and the developer's own keys", () => {
    const first = functionsEnvFile({ ...base, enforceAppCheck: true, extra: { MY_FLAG: "1" } });
    const parsed = parseEnvFile(first);
    const second = functionsEnvFile({ ...base, enforceAppCheck: parsed.CLAYVER_ENFORCE_APP_CHECK === "true", extra: parsed });
    expect(second).toBe(first);
    expect(parsed.MY_FLAG).toBe("1");
    expect(second.match(/CLAYVER_FUNCTIONS_REGION=/g)).toHaveLength(1);
  });
});
