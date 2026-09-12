import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover mill prefix on Team boards that stay skip-list for Setup
 * required (display / audit / posture / export audit) plus the public
 * Showcase deck. Do not invent a last-snapshot here — only drop VANTAGE /.
 */
const FILES = [
  "app/display/page.tsx",
  "app/team/audit/page.tsx",
  "app/team/posture/posture-client.tsx",
  "app/team/security/exports/export-audit-client.tsx",
  "app/showcase/present/presentation-client.tsx",
] as const;

describe("leftover mill prefix on display / audit / posture", () => {
  it("does not print VANTAGE / on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/Authentication required/);
    }
  });
});
