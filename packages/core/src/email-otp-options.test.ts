import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Better Auth's emailOTP spreads our options over its defaults
 * (`{ generateOTP: default, ...options }`). A key set to `undefined` therefore removes the
 * default: production passed `generateOTP: undefined` and every email sign-in code failed with
 * "generateOTP is not a function". Optional plugin options are added only when they have a value.
 */
describe("emailOTP options", () => {
  const source = readFileSync(join(__dirname, "index.ts"), "utf8");
  const plugin = source.slice(source.indexOf("emailOTP({"), source.indexOf("sendVerificationOTP:", source.indexOf("emailOTP({")));

  it("never passes generateOTP as undefined", () => {
    expect(plugin).toContain("emailOTP({");
    expect(plugin).not.toMatch(/generateOTP:\s*\n?\s*process\.env\.NODE_ENV === "production"\s*\?\s*undefined/);
    expect(plugin).not.toMatch(/generateOTP:\s*undefined/);
  });

  it("only adds the local generator outside production", () => {
    expect(plugin).toMatch(/process\.env\.NODE_ENV === "production"\s*\?\s*\{\}\s*:\s*\{\s*generateOTP:/);
  });
});
