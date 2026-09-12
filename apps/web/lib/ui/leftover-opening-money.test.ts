import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-notebook. Hub labels stay Season costs, Mock judging, and
 * Tier calculator. leftover-business-more extras stay. leftover-opening-notebook
 * Opening Engineering notebook, leftover-opening-people Opening Alumni,
 * leftover-opening-reviews Opening Design reviews, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-community-impact
 * Impact stays. leftover-offline extras and leftover-hub extras stay off
 * these FILES. leftover-safety Safety incidents stays. Routes stay. Do
 * not invent a last-snapshot.
 */
const FILES = [
  "app/costs/costs-client.tsx",
  "app/mock-judging/mock-judging-client.tsx",
  "app/sponsor-tier-calculator/sponsor-tier-calculator-client.tsx",
] as const;

describe("leftover student opening-money chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Season Costs/);
      expect(src, rel).not.toMatch(/Mock Judging/);
      expect(src, rel).not.toMatch(/Sponsor Tier Calculator/);
    }
    const costs = readFileSync(join(WEB, "app/costs/costs-client.tsx"), "utf8");
    expect(costs).toMatch(/Opening Season costs/);
    expect(costs).toMatch(/title="Season costs"/);
    expect(costs).toMatch(/feature="Season costs"/);
    const judging = readFileSync(join(WEB, "app/mock-judging/mock-judging-client.tsx"), "utf8");
    expect(judging).toMatch(/Opening Mock judging/);
    expect(judging).toMatch(/title="Mock judging"/);
    expect(judging).toMatch(/feature="Mock judging"/);
    const tier = readFileSync(
      join(WEB, "app/sponsor-tier-calculator/sponsor-tier-calculator-client.tsx"),
      "utf8",
    );
    expect(tier).toMatch(/Opening Tier calculator/);
    expect(tier).toMatch(/title="Tier calculator"/);
    expect(tier).toMatch(/feature="Tier calculator"/);
  });
});
