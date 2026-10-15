import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("account recovery page styles", () => {
  it("loads the same style layers as the sign-in page, since it sits outside the app frame", () => {
    const recovery = readFileSync(join(__dirname, "account-recovery-client.tsx"), "utf8");
    const signIn = readFileSync(join(__dirname, "../sign-in/sign-in-client.tsx"), "utf8");
    for (const sheet of ['"../product-styles"', "sign-in-flow.css", "vantage-scan-auth.css"]) {
      expect(signIn).toContain(sheet);
      expect(recovery).toContain(sheet);
    }
  });
});
