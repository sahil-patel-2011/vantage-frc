import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Coverage / Shifts / Pit link / Field value /
 * Data quality / Pairwise titles after leftover-strategy-titles.
 * Hub labels stay Coverage, Shifts, Pit link, Field value,
 * Data quality, and Pairwise. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/scout-coverage-live/scout-coverage-live-client.tsx",
  "app/scout-coverage-live/page.tsx",
  "lib/scout-coverage-live/scout-coverage-live-related.ts",
  "lib/manifests/scout-coverage-live.manifest.ts",
  "app/shift-balancer/shift-balancer-client.tsx",
  "app/shift-balancer/page.tsx",
  "app/scout-p2p-relay/scout-p2p-relay-client.tsx",
  "app/scout-p2p-relay/page.tsx",
  "app/scout-p2p-relay/pit-mesh-panel.tsx",
  "app/api/scout-p2p-relay/route.ts",
  "lib/manifests/scout-p2p-relay.manifest.ts",
  "app/scout-field-budget/scout-field-budget-client.tsx",
  "app/scout-field-budget/page.tsx",
  "lib/scout-field-budget/scout-field-budget-related.ts",
  "lib/manifests/scout-field-budget.manifest.ts",
  "app/data-quality-scorecard/data-quality-scorecard-client.tsx",
  "app/data-quality-scorecard/page.tsx",
  "app/api/data-quality-scorecard/route.ts",
  "lib/manifests/data-quality-scorecard.manifest.ts",
  "app/pairwise/pairwise-client.tsx",
  "app/pairwise/page.tsx",
  "lib/manifests/pairwise.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student scout-title chrome", () => {
  it("does not print leftover Coverage Live / Pit mesh / Scorecard titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Scout Coverage Live/);
      expect(src, rel).not.toMatch(/Coverage Live/);
      expect(src, rel).not.toMatch(/Scout shift load balancer/);
      expect(src, rel).not.toMatch(/Scout shift balancer/);
      expect(src, rel).not.toMatch(/Shift Balancer/);
      expect(src, rel).not.toMatch(/Pit mesh/);
      expect(src, rel).not.toMatch(/Scouting Field-Count Budget/);
      expect(src, rel).not.toMatch(/Field-Count Budget/);
      expect(src, rel).not.toMatch(/Data Quality Scorecard/);
      expect(src, rel).not.toMatch(/Pairwise ranking/);
    }
    const coverage = readFileSync(join(WEB, "app/scout-coverage-live/scout-coverage-live-client.tsx"), "utf8");
    expect(coverage).toMatch(/title="Coverage"/);
    expect(coverage).toMatch(/feature="Coverage"/);
    expect(coverage).toMatch(/Opening Coverage/);
    const shifts = readFileSync(join(WEB, "app/shift-balancer/shift-balancer-client.tsx"), "utf8");
    expect(shifts).toMatch(/title="Shifts"/);
    expect(shifts).toMatch(/feature="Shifts"/);
    expect(shifts).toMatch(/Opening Shifts/);
    const pit = readFileSync(join(WEB, "app/scout-p2p-relay/scout-p2p-relay-client.tsx"), "utf8");
    expect(pit).toMatch(/title="Pit link"/);
    expect(pit).toMatch(/feature="Pit link"/);
    const field = readFileSync(join(WEB, "app/scout-field-budget/scout-field-budget-client.tsx"), "utf8");
    expect(field).toMatch(/title="Field value"/);
    expect(field).toMatch(/feature="Field value"/);
    const quality = readFileSync(join(WEB, "app/data-quality-scorecard/data-quality-scorecard-client.tsx"), "utf8");
    expect(quality).toMatch(/title="Data quality"/);
    expect(quality).toMatch(/feature="Data quality"/);
    const pairwise = readFileSync(join(WEB, "app/pairwise/pairwise-client.tsx"), "utf8");
    expect(pairwise).toMatch(/title="Pairwise"/);
    expect(pairwise).toMatch(/feature="Pairwise"/);
  });
});
