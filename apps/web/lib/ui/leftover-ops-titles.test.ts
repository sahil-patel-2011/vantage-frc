import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Lead times / Deploy log / Season plan / Scrims /
 * Risk burndown titles after leftover-cad-titles. Hub labels stay
 * Lead times, Deploy log, Season plan, Scrims, and Risk burndown.
 * Routes stay. Help / llms Season plan gold stays off this lock.
 * leftover-fmea Failure log and leftover-pick-before Choose your team
 * stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/vendor-lead-times/vendor-lead-times-client.tsx",
  "app/vendor-lead-times/page.tsx",
  "lib/vendor-lead-times/vendor-lead-times-related.ts",
  "lib/vendor-lead-times/compute-vendor-lead-times.ts",
  "lib/manifests/vendor-lead-times.manifest.ts",
  "lib/vendors/vendors-related.ts",
  "lib/vendors/compute-vendors.ts",
  "app/vendors/vendors-client.tsx",
  "app/code-deploy-log/code-deploy-log-client.tsx",
  "app/code-deploy-log/page.tsx",
  "lib/code-deploy-log/code-deploy-log-related.ts",
  "lib/manifests/code-deploy-log.manifest.ts",
  "app/season-planning-workspace/season-planning-workspace-client.tsx",
  "app/season-planning-workspace/page.tsx",
  "lib/season-planning-workspace/season-planning-workspace-related.ts",
  "app/api/season-planning-workspace/route.ts",
  "lib/manifests/season-planning-workspace.manifest.ts",
  "app/cross-team-scrim/cross-team-scrim-client.tsx",
  "app/cross-team-scrim/page.tsx",
  "lib/cross-team-scrim/cross-team-scrim-related.ts",
  "lib/manifests/cross-team-scrim.manifest.ts",
  "app/risk-burndown/risk-burndown-client.tsx",
  "app/risk-burndown/page.tsx",
  "lib/risk-burndown/risk-burndown-related.ts",
  "lib/risk-burndown/compute-risk-burndown.ts",
  "lib/manifests/risk-burndown.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student ops-title chrome", () => {
  it("does not print leftover Tracker / Deploy / Planning / Scrim titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Vendor Lead Times/);
      expect(src, rel).not.toMatch(/Vendor Lead-Time Tracker/);
      expect(src, rel).not.toMatch(/Open Vendor Lead Times/);
      expect(src, rel).not.toMatch(/Code Deploy Log/);
      expect(src, rel).not.toMatch(/Season Planning Workspace/);
      expect(src, rel).not.toMatch(/Season Planning/);
      expect(src, rel).not.toMatch(/Cross-Team Scrims/);
      expect(src, rel).not.toMatch(/Cross-Team Scrim Scheduling/);
      expect(src, rel).not.toMatch(/Risk-Register Burndown/);
    }
    const lead = readFileSync(
      join(WEB, "app/vendor-lead-times/vendor-lead-times-client.tsx"),
      "utf8",
    );
    expect(lead).toMatch(/title="Lead times"/);
    expect(lead).toMatch(/feature="Lead times"/);
    const deploy = readFileSync(
      join(WEB, "app/code-deploy-log/code-deploy-log-client.tsx"),
      "utf8",
    );
    expect(deploy).toMatch(/title="Deploy log"/);
    expect(deploy).toMatch(/feature="Deploy log"/);
    const season = readFileSync(
      join(WEB, "app/season-planning-workspace/season-planning-workspace-client.tsx"),
      "utf8",
    );
    expect(season).toMatch(/title="Season plan"/);
    expect(season).toMatch(/feature="Season plan"/);
    const scrims = readFileSync(
      join(WEB, "app/cross-team-scrim/cross-team-scrim-client.tsx"),
      "utf8",
    );
    expect(scrims).toMatch(/title="Scrims"/);
    expect(scrims).toMatch(/feature="Scrims"/);
    const risk = readFileSync(
      join(WEB, "app/risk-burndown/risk-burndown-client.tsx"),
      "utf8",
    );
    expect(risk).toMatch(/title="Risk burndown"/);
    expect(risk).toMatch(/feature="Risk burndown"/);
    expect(risk).toMatch(/How likely/);
    expect(risk).toMatch(/How bad/);
    expect(risk).toMatch(/Failure log/);
    const leadRelated = readFileSync(
      join(WEB, "lib/vendor-lead-times/vendor-lead-times-related.ts"),
      "utf8",
    );
    expect(leadRelated).toMatch(/Opening Lead times/);
    expect(leadRelated).not.toMatch(/title="Loading/);
    expect(leadRelated).toMatch(/Choose your team/);
    expect(leadRelated).toMatch(/Open Spares forecast/);
    const deployRelated = readFileSync(
      join(WEB, "lib/code-deploy-log/code-deploy-log-related.ts"),
      "utf8",
    );
    expect(deployRelated).toMatch(/Opening Deploy log/);
    expect(deployRelated).not.toMatch(/title="Loading/);
    expect(deployRelated).toMatch(/Choose your team/);
    expect(deployRelated).toMatch(/Open Readiness/);
    const seasonRelated = readFileSync(
      join(WEB, "lib/season-planning-workspace/season-planning-workspace-related.ts"),
      "utf8",
    );
    expect(seasonRelated).toMatch(/Opening Season plan/);
    expect(seasonRelated).not.toMatch(/title="Loading/);
    expect(seasonRelated).toMatch(/Choose your team/);
    const scrimRelated = readFileSync(
      join(WEB, "lib/cross-team-scrim/cross-team-scrim-related.ts"),
      "utf8",
    );
    expect(scrimRelated).toMatch(/Opening Scrims/);
    expect(scrimRelated).not.toMatch(/title="Loading/);
    expect(scrimRelated).toMatch(/Choose your team/);
    const riskRelated = readFileSync(
      join(WEB, "lib/risk-burndown/risk-burndown-related.ts"),
      "utf8",
    );
    expect(riskRelated).toMatch(/Opening Risk burndown/);
    expect(riskRelated).not.toMatch(/title="Loading/);
    expect(riskRelated).toMatch(/Open Failure log/);
    expect(riskRelated).not.toMatch(/Open FMEA/);
  });
});
