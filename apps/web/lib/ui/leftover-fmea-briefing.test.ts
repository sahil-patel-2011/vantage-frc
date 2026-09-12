import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student FMEA / RPN chrome on Pre-match briefing and Match Copilot
 * after the Chemistry / Ask AI gold. Route id `fmea` stays. Do not invent a
 * last-snapshot. The Failure Log board itself is a later family.
 */
const FILES = [
  "app/briefing/briefing-client.tsx",
  "app/match-copilot/match-copilot-client.tsx",
  "lib/match-copilot/match-copilot-related.ts",
  "lib/match-copilot/compute-match-copilot.ts",
  "lib/manifests/match-copilot.manifest.ts",
] as const;

describe("leftover student FMEA / RPN event-day chrome", () => {
  it("does not print leftover FMEA or RPN phrases on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Open FMEA/);
      expect(src, rel).not.toMatch(/Open FMEA risks/);
      expect(src, rel).not.toMatch(/open FMEA risks/);
      expect(src, rel).not.toMatch(/\bRPN\b/);
      expect(src, rel).toMatch(/Failure log|failure risk|failure risks/);
    }
  });
});
