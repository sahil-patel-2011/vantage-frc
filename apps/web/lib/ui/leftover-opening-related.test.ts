import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student related-strip title: "Loading…" boards after leftover
 * opening-releases. leftover-invites no Team admin / Choose your team,
 * leftover-product-chrome Chat limits / Needs setup, leftover-pick-before
 * connect GitHub under Invites, leftover-cad Pair VS Code,
 * leftover-opening-releases Opening What’s new, leftover-fmea Failure log
 * stay. Hub My Day / Schema A/B stay. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "lib/github/github-related.ts",
  "lib/ai-governance/ai-governance-related.ts",
  "lib/billing/ai-budgets-related.ts",
] as const;

describe("leftover student opening-related chrome", () => {
  it("does not print leftover related Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
    }
    const github = readFileSync(join(WEB, "lib/github/github-related.ts"), "utf8");
    expect(github).toMatch(/Opening GitHub/);
    expect(github).toMatch(/Choose your team/);
    expect(github).toMatch(/Pair VS Code/);
    const governance = readFileSync(
      join(WEB, "lib/ai-governance/ai-governance-related.ts"),
      "utf8",
    );
    expect(governance).toMatch(/Opening AI governance/);
    const budgets = readFileSync(join(WEB, "lib/billing/ai-budgets-related.ts"), "utf8");
    expect(budgets).toMatch(/Opening Chat limits/);
    expect(budgets).toMatch(/Opening AI usage/);
    expect(budgets).toMatch(/Needs setup/);
  });
});
