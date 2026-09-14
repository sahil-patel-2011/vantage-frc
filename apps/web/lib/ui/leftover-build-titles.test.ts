import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Failure patterns / Incidents / Rule impact /
 * Bin locator / Pack health titles after leftover-people-more.
 * Hub labels stay Failure patterns, Incidents, Rule impact,
 * Bin locator, and Pack health. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/failure-patterns/failure-patterns-client.tsx",
  "app/failure-patterns/page.tsx",
  "lib/failure-patterns/failure-patterns-related.ts",
  "lib/manifests/failure-patterns.manifest.ts",
  "app/incident-heatmap/incident-heatmap-client.tsx",
  "app/incident-heatmap/page.tsx",
  "app/api/incident-heatmap/route.ts",
  "lib/manifests/incident-heatmap.manifest.ts",
  "app/rule-impact/rule-impact-client.tsx",
  "app/rule-impact/page.tsx",
  "lib/rule-impact/rule-impact-related.ts",
  "lib/manifests/rule-impact.manifest.ts",
  "app/bin-shelf-locator/bin-shelf-locator-client.tsx",
  "app/bin-shelf-locator/page.tsx",
  "lib/bin-shelf-locator/bin-shelf-locator-related.ts",
  "app/api/bin-shelf-locator/route.ts",
  "lib/manifests/bin-shelf-locator.manifest.ts",
  "app/battery-health-forecast/battery-health-forecast-client.tsx",
  "app/battery-health-forecast/page.tsx",
  "lib/battery-health-forecast/battery-health-forecast-related.ts",
  "app/api/battery-health-forecast/route.ts",
  "lib/manifests/battery-health-forecast.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student build-title chrome", () => {
  it("does not print leftover Analyzer / Heatmap / Locator titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Repeat Failure Patterns/);
      expect(src, rel).not.toMatch(/Failure Patterns/);
      expect(src, rel).not.toMatch(/Incident Heatmap/);
      expect(src, rel).not.toMatch(/Rule Impact Analyzer/);
      expect(src, rel).not.toMatch(/Retry Rule Impact/);
      expect(src, rel).not.toMatch(/Bin\/Shelf Locator/);
      expect(src, rel).not.toMatch(/Battery Health Forecast/);
    }
    const patterns = readFileSync(
      join(WEB, "app/failure-patterns/failure-patterns-client.tsx"),
      "utf8",
    );
    expect(patterns).toMatch(/title="Failure patterns"/);
    expect(patterns).toMatch(/feature="Failure patterns"/);
    expect(patterns).toMatch(/Failure log ·/);
    const incidents = readFileSync(
      join(WEB, "app/incident-heatmap/incident-heatmap-client.tsx"),
      "utf8",
    );
    expect(incidents).toMatch(/title="Incidents"/);
    expect(incidents).toMatch(/feature="Incidents"/);
    const impact = readFileSync(join(WEB, "app/rule-impact/rule-impact-client.tsx"), "utf8");
    expect(impact).toMatch(/title="Rule impact"/);
    expect(impact).toMatch(/feature="Rule impact"/);
    const bins = readFileSync(
      join(WEB, "app/bin-shelf-locator/bin-shelf-locator-client.tsx"),
      "utf8",
    );
    expect(bins).toMatch(/title="Bin locator"/);
    expect(bins).toMatch(/feature="Bin locator"/);
    const packs = readFileSync(
      join(WEB, "app/battery-health-forecast/battery-health-forecast-client.tsx"),
      "utf8",
    );
    expect(packs).toMatch(/title="Pack health"/);
    expect(packs).toMatch(/feature="Pack health"/);
    const related = readFileSync(
      join(WEB, "lib/failure-patterns/failure-patterns-related.ts"),
      "utf8",
    );
    expect(related).toMatch(/Opening Failure patterns/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
    expect(related).toMatch(/Open Repair triage/);
    expect(related).toMatch(/Open Failure log/);
    const binsRelated = readFileSync(
      join(WEB, "lib/bin-shelf-locator/bin-shelf-locator-related.ts"),
      "utf8",
    );
    expect(binsRelated).toMatch(/Opening Bin locator/);
    expect(binsRelated).not.toMatch(/title="Loading/);
    expect(binsRelated).toMatch(/Choose your team/);
    expect(binsRelated).toMatch(/Open Spares forecast/);
  });
});
