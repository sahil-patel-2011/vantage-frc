import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Equipment / Safety / Alumni / Search / Reports titles
 * after leftover-ops-titles. Hub labels stay Equipment, Safety, Alumni,
 * Search, and Reports. Routes stay. Season Goals / Morning standup stay
 * on season-goals-standup-chrome. leftover-fmea Failure log and
 * leftover-pick-before Choose your team stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/equipment-maintenance/equipment-maintenance-client.tsx",
  "app/equipment-maintenance/page.tsx",
  "lib/equipment-maintenance/equipment-maintenance-related.ts",
  "lib/manifests/equipment-maintenance.manifest.ts",
  "app/api/equipment-maintenance/route.ts",
  "lib/tool-checkout/tool-checkout-related.ts",
  "app/safety-training/safety-training-client.tsx",
  "app/safety-training/page.tsx",
  "lib/manifests/safety-training.manifest.ts",
  "app/api/safety-training/route.ts",
  "app/alumni-network/alumni-network-client.tsx",
  "app/alumni-network/page.tsx",
  "lib/manifests/alumni-network.manifest.ts",
  "app/exit-interview/exit-interview-client.tsx",
  "app/mentor-hours/mentor-hours-client.tsx",
  "app/decision-search/decision-search-client.tsx",
  "app/decision-search/page.tsx",
  "lib/decision-search/decision-search-related.ts",
  "lib/manifests/decision-search.manifest.ts",
  "app/api/decision-search/route.ts",
  "lib/decisions/decisions-related.ts",
  "app/decisions/page.tsx",
  "lib/season-report/season-report-related.ts",
  "app/grant-report/grant-report-client.tsx",
  "app/grant-report/page.tsx",
  "lib/grant-report/grant-report-related.ts",
  "lib/manifests/grant-report.manifest.ts",
  "app/api/grant-report/route.ts",
  "lib/grant-eligibility-matcher/grant-eligibility-matcher-related.ts",
  "app/grant-eligibility-matcher/grant-eligibility-matcher-client.tsx",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student kit-title chrome", () => {
  it("does not print leftover Maintenance / Training / Network / Search titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Equipment Maintenance/);
      expect(src, rel).not.toMatch(/Open Equipment Maintenance/);
      expect(src, rel).not.toMatch(/Safety Training/);
      expect(src, rel).not.toMatch(/Open Safety Training/);
      expect(src, rel).not.toMatch(/Alumni Network/);
      expect(src, rel).not.toMatch(/Open Alumni Network/);
      expect(src, rel).not.toMatch(/Decision Search/);
      expect(src, rel).not.toMatch(/Open Decision Search/);
      expect(src, rel).not.toMatch(/Grant Report/);
      expect(src, rel).not.toMatch(/Open Grant Report/);
    }
    const equipment = readFileSync(
      join(WEB, "app/equipment-maintenance/equipment-maintenance-client.tsx"),
      "utf8",
    );
    expect(equipment).toMatch(/title="Equipment"/);
    expect(equipment).toMatch(/feature="Equipment"/);
    const safety = readFileSync(
      join(WEB, "app/safety-training/safety-training-client.tsx"),
      "utf8",
    );
    expect(safety).toMatch(/title="Safety"/);
    expect(safety).toMatch(/feature="Safety"/);
    const alumni = readFileSync(
      join(WEB, "app/alumni-network/alumni-network-client.tsx"),
      "utf8",
    );
    expect(alumni).toMatch(/title="Alumni"/);
    expect(alumni).toMatch(/feature="Alumni"/);
    const search = readFileSync(
      join(WEB, "app/decision-search/decision-search-client.tsx"),
      "utf8",
    );
    expect(search).toMatch(/title="Search"/);
    expect(search).toMatch(/feature="Search"/);
    const reports = readFileSync(
      join(WEB, "app/grant-report/grant-report-client.tsx"),
      "utf8",
    );
    expect(reports).toMatch(/title="Reports"/);
    expect(reports).toMatch(/feature="Reports"/);
    const equipmentRelated = readFileSync(
      join(WEB, "lib/equipment-maintenance/equipment-maintenance-related.ts"),
      "utf8",
    );
    expect(equipmentRelated).toMatch(/Opening Equipment/);
    expect(equipmentRelated).not.toMatch(/title="Loading/);
    expect(equipmentRelated).toMatch(/Choose your team/);
    expect(equipmentRelated).toMatch(/Open Safety/);
    const searchRelated = readFileSync(
      join(WEB, "lib/decision-search/decision-search-related.ts"),
      "utf8",
    );
    expect(searchRelated).toMatch(/Opening Search/);
    expect(searchRelated).not.toMatch(/title="Loading/);
    expect(searchRelated).toMatch(/Choose your team/);
    const reportsRelated = readFileSync(
      join(WEB, "lib/grant-report/grant-report-related.ts"),
      "utf8",
    );
    expect(reportsRelated).toMatch(/Opening Reports/);
    expect(reportsRelated).not.toMatch(/title="Loading/);
    expect(reportsRelated).toMatch(/Choose your team/);
    const exit = readFileSync(join(WEB, "app/exit-interview/exit-interview-client.tsx"), "utf8");
    expect(exit).toMatch(/title="Exit interviews"/);
    expect(exit).toMatch(/Open Alumni/);
  });
});
