import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Goals / Standup / My kit / Field reset / Season report
 * titles after leftover-kit-titles. Hub labels stay Goals, Standup, My kit,
 * Field reset, and Season report. Routes stay. leftover-cad-map CAD
 * review queue / Control map stay. leftover-fmea Failure log and
 * leftover-pick-before Choose your team stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/goals-tracker/goals-tracker-client.tsx",
  "app/goals-tracker/page.tsx",
  "app/api/goals-tracker/route.ts",
  "lib/manifests/goals-tracker.manifest.ts",
  "lib/season-planning-workspace/season-planning-workspace-related.ts",
  "lib/hours-self-view/hours-self-view-related.ts",
  "app/standup-digest/standup-digest-client.tsx",
  "app/standup-digest/page.tsx",
  "app/meeting-autopilot/meeting-autopilot-client.tsx",
  "app/my-kit/my-kit-client.tsx",
  "app/my-kit/page.tsx",
  "app/api/my-kit/route.ts",
  "lib/my-kit/compose.ts",
  "app/field-reset-timer/field-reset-timer-client.tsx",
  "app/field-reset-timer/page.tsx",
  "lib/field-reset-timer/field-reset-timer-related.ts",
  "app/api/field-reset-timer/route.ts",
  "app/season-report/season-report-client.tsx",
  "app/season-report/page.tsx",
  "lib/season-report/season-report-related.ts",
  "lib/manifests/season-report.manifest.ts",
  "lib/decisions/decisions-related.ts",
  "lib/decision-search/decision-search-related.ts",
  "app/decisions/page.tsx",
  "app/decision-search/page.tsx",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student goals-kit chrome", () => {
  it("does not print leftover Season Goals / Morning standup / My Kit titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Season Goals Tracker/);
      expect(src, rel).not.toMatch(/Open Season Goals/);
      expect(src, rel).not.toMatch(/Season Goals/);
      expect(src, rel).not.toMatch(/Morning standup/);
      expect(src, rel).not.toMatch(/My Kit/);
      expect(src, rel).not.toMatch(/Field reset timer/);
      expect(src, rel).not.toMatch(/Field Reset Timer/);
      expect(src, rel).not.toMatch(/Open Season Report/);
      expect(src, rel).not.toMatch(/Season Report/);
    }
    const goals = readFileSync(join(WEB, "app/goals-tracker/goals-tracker-client.tsx"), "utf8");
    expect(goals).toMatch(/title="Goals"/);
    expect(goals).toMatch(/feature="Goals"/);
    const standup = readFileSync(join(WEB, "app/standup-digest/standup-digest-client.tsx"), "utf8");
    expect(standup).toMatch(/title="Standup"/);
    expect(standup).toMatch(/feature="Standup"/);
    const kit = readFileSync(join(WEB, "app/my-kit/my-kit-client.tsx"), "utf8");
    expect(kit).toMatch(/title="My kit"/);
    expect(kit).toMatch(/feature="My kit"/);
    const field = readFileSync(
      join(WEB, "app/field-reset-timer/field-reset-timer-client.tsx"),
      "utf8",
    );
    expect(field).toMatch(/title="Field reset"/);
    expect(field).toMatch(/feature="Field reset"/);
    const report = readFileSync(join(WEB, "app/season-report/season-report-client.tsx"), "utf8");
    expect(report).toMatch(/title="Season report"/);
    expect(report).toMatch(/feature="Season report"/);
    const fieldRelated = readFileSync(
      join(WEB, "lib/field-reset-timer/field-reset-timer-related.ts"),
      "utf8",
    );
    expect(fieldRelated).toMatch(/Opening Field reset/);
    expect(fieldRelated).not.toMatch(/title="Loading/);
    expect(fieldRelated).toMatch(/Choose your team/);
    const reportRelated = readFileSync(
      join(WEB, "lib/season-report/season-report-related.ts"),
      "utf8",
    );
    expect(reportRelated).toMatch(/Opening Season report/);
    expect(reportRelated).not.toMatch(/title="Loading/);
    expect(reportRelated).toMatch(/Choose your team/);
    const seasonRelated = readFileSync(
      join(WEB, "lib/season-planning-workspace/season-planning-workspace-related.ts"),
      "utf8",
    );
    expect(seasonRelated).toMatch(/Open Goals/);
    expect(seasonRelated).toMatch(/Choose your team/);
    const decisions = readFileSync(join(WEB, "lib/decisions/decisions-related.ts"), "utf8");
    expect(decisions).toMatch(/Open Season report/);
    expect(decisions).toMatch(/Choose your team/);
    const search = readFileSync(join(WEB, "lib/decision-search/decision-search-related.ts"), "utf8");
    expect(search).toMatch(/Open Season report/);
    expect(search).toMatch(/Choose your team/);
    const compose = readFileSync(join(WEB, "lib/my-kit/compose.ts"), "utf8");
    expect(compose).toMatch(/Failure log/);
    expect(compose).not.toMatch(/Open FMEA/);
    expect(compose).toMatch(/Choose your team/);
  });
});
