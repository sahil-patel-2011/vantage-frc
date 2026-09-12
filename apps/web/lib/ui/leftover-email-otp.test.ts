import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student "email OTP" next-actions on AI Governance / Budgets /
 * Usage / Memory after leftover-pick-before. Admin integration-health
 * stays operator copy. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/ai-governance/ai-governance-related.ts",
  "lib/billing/ai-budgets-related.ts",
  "lib/ai-memory/ai-memory-related.ts",
] as const;

describe("leftover student email OTP chrome", () => {
  it("does not tell the reader to use email OTP on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/email OTP/);
      expect(src, rel).toMatch(/emailed sign-in code/);
    }
  });
});
