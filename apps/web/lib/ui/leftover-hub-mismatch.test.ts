import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Spare-Parts / Essay Generator / Selection Desk / Rollup /
 * Triage titles after leftover-hub-titles. Hub labels stay Spares forecast,
 * Spare kit, Impact essay, Alliance desk, BOM cost, and Repair triage.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/spare-forecast/spare-forecast-client.tsx",
  "app/spare-forecast/page.tsx",
  "app/api/spare-forecast/route.ts",
  "lib/spare-forecast/spare-forecast-related.ts",
  "lib/manifests/spare-forecast.manifest.ts",
  "app/spare-robot-kit/spare-robot-kit-client.tsx",
  "app/spare-robot-kit/page.tsx",
  "app/api/spare-robot-kit/route.ts",
  "lib/spare-robot-kit/spare-robot-kit-related.ts",
  "lib/manifests/spare-robot-kit.manifest.ts",
  "app/impact-essay/impact-essay-client.tsx",
  "app/impact-essay/page.tsx",
  "app/api/impact-essay/route.ts",
  "lib/impact-essay/impact-essay-related.ts",
  "lib/impact-essay/compute-impact-essay.ts",
  "lib/manifests/impact-essay.manifest.ts",
  "app/alliance-selection-desk/alliance-selection-desk-client.tsx",
  "app/alliance-selection-desk/page.tsx",
  "app/api/alliance-selection-desk/route.ts",
  "lib/alliance-selection-desk/alliance-selection-desk-related.ts",
  "lib/alliance-selection-desk/compute-alliance-selection-desk.ts",
  "lib/manifests/alliance-selection-desk.manifest.ts",
  "app/bom-cost-rollup/bom-cost-rollup-client.tsx",
  "app/bom-cost-rollup/page.tsx",
  "app/api/bom-cost-rollup/route.ts",
  "lib/manifests/bom-cost-rollup.manifest.ts",
  "app/pit-repair-triage/pit-repair-triage-client.tsx",
  "app/pit-repair-triage/page.tsx",
  "app/api/pit-repair-triage/route.ts",
  "lib/pit-repair-triage/pit-repair-triage-related.ts",
  "lib/manifests/pit-repair-triage.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student hub-mismatch chrome", () => {
  it("does not print leftover Forecast / Generator / Desk / Rollup titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Spare-Parts Failure Forecast/);
      expect(src, rel).not.toMatch(/Spare Forecast/);
      expect(src, rel).not.toMatch(/Spare Robot Kit Checklist/);
      expect(src, rel).not.toMatch(/Spare Robot Kit/);
      expect(src, rel).not.toMatch(/FIRST Impact Essay Generator/);
      expect(src, rel).not.toMatch(/Impact Essay/);
      expect(src, rel).not.toMatch(/Alliance Selection Desk 2\.0/);
      expect(src, rel).not.toMatch(/Alliance Selection Desk/);
      expect(src, rel).not.toMatch(/Alliance selection desk/);
      expect(src, rel).not.toMatch(/BOM Cost Rollup/);
      expect(src, rel).not.toMatch(/BOM cost rollup/);
      expect(src, rel).not.toMatch(/Pit Repair Triage/);
      expect(src, rel).not.toMatch(/Pit repair triage/);
    }
    const forecast = readFileSync(join(WEB, "app/spare-forecast/spare-forecast-client.tsx"), "utf8");
    expect(forecast).toMatch(/title="Spares forecast"/);
    expect(forecast).toMatch(/feature="Spares forecast"/);
    const kit = readFileSync(join(WEB, "app/spare-robot-kit/spare-robot-kit-client.tsx"), "utf8");
    expect(kit).toMatch(/title="Spare kit"/);
    expect(kit).toMatch(/feature="Spare kit"/);
    const essay = readFileSync(join(WEB, "app/impact-essay/impact-essay-client.tsx"), "utf8");
    expect(essay).toMatch(/title="Impact essay"/);
    expect(essay).toMatch(/feature="Impact essay"/);
    const desk = readFileSync(join(WEB, "app/alliance-selection-desk/alliance-selection-desk-client.tsx"), "utf8");
    expect(desk).toMatch(/title="Alliance desk"/);
    expect(desk).toMatch(/feature="Alliance desk"/);
    const deskRelated = readFileSync(
      join(WEB, "lib/alliance-selection-desk/alliance-selection-desk-related.ts"),
      "utf8",
    );
    expect(deskRelated).toMatch(/Opening Alliance desk/);
    expect(deskRelated).toMatch(/label: "Pick list"/);
    expect(deskRelated).toMatch(/Open Pick list/);
    expect(deskRelated).toMatch(/label: "Pick clock"/);
    const bom = readFileSync(join(WEB, "app/bom-cost-rollup/bom-cost-rollup-client.tsx"), "utf8");
    expect(bom).toMatch(/title="BOM cost"/);
    expect(bom).toMatch(/feature="BOM cost"/);
    expect(bom).toMatch(/Opening BOM cost/);
    const repair = readFileSync(join(WEB, "app/pit-repair-triage/pit-repair-triage-client.tsx"), "utf8");
    expect(repair).toMatch(/title="Repair triage"/);
    expect(repair).toMatch(/feature="Repair triage"/);
  });
});
