import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Skills / Risk register / Burndown titles after
 * leftover-business-more. Hub labels stay Skills, Risk register, and
 * Burndown. leftover-ops-titles Lead times family, leftover-goals-kit
 * Goals, leftover-fmea Failure log, leftover-lxi How likely / How bad,
 * leftover-join-or-pick Choose your team, leftover-pick-before Choose
 * your team stay. leftover-event-day-more Event day stays. Routes
 * stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/skills-graph/skills-graph-client.tsx",
  "app/skills-graph/page.tsx",
  "app/risks/risks-client.tsx",
  "app/risks/page.tsx",
  "lib/risks/risks-related.ts",
  "app/build-burndown/build-burndown-client.tsx",
  "app/build-burndown/page.tsx",
  "lib/build-burndown/build-burndown-related.ts",
  "lib/season-planning-workspace/season-planning-workspace-related.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student ops-more chrome", () => {
  it("does not print leftover Skills & Mentorship / Risk Register titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Skills & Mentorship Graph/);
      expect(src, rel).not.toMatch(/Skills & Mentorship/);
      expect(src, rel).not.toMatch(/Risk Register/);
      expect(src, rel).not.toMatch(/Build-Season Burndown/);
      expect(src, rel).not.toMatch(/Build Burndown/);
    }
    const skills = readFileSync(join(WEB, "app/skills-graph/skills-graph-client.tsx"), "utf8");
    expect(skills).toMatch(/title="Skills"/);
    expect(skills).toMatch(/feature="Skills"/);
    expect(skills).toMatch(/Opening Skills/);
    expect(skills).not.toMatch(/title="Loading/);
    const risks = readFileSync(join(WEB, "app/risks/risks-client.tsx"), "utf8");
    expect(risks).toMatch(/title="Risk register"/);
    expect(risks).toMatch(/feature="Risk register"/);
    expect(risks).toMatch(/Opening Risk register/);
    expect(risks).not.toMatch(/title="Loading/);
    expect(risks).toMatch(/How likely/);
    expect(risks).toMatch(/How bad/);
    expect(risks).toMatch(/Failure log/);
    expect(risks).not.toMatch(/Open FMEA/);
    const burndown = readFileSync(
      join(WEB, "app/build-burndown/build-burndown-client.tsx"),
      "utf8",
    );
    expect(burndown).toMatch(/title="Burndown"/);
    expect(burndown).toMatch(/feature="Burndown"/);
    expect(burndown).toMatch(/Failure log/);
    expect(burndown).not.toMatch(/Open FMEA/);
    const burndownRelated = readFileSync(
      join(WEB, "lib/build-burndown/build-burndown-related.ts"),
      "utf8",
    );
    expect(burndownRelated).toMatch(/Opening Burndown/);
    expect(burndownRelated).not.toMatch(/title="Loading/);
    expect(burndownRelated).toMatch(/Choose your team/);
    expect(burndownRelated).not.toMatch(/\bPick a team\b/);
    expect(burndownRelated).not.toMatch(/Join or pick a team/);
    expect(burndownRelated).toMatch(/Failure log/);
    expect(burndownRelated).not.toMatch(/Open FMEA/);
    const seasonRelated = readFileSync(
      join(WEB, "lib/season-planning-workspace/season-planning-workspace-related.ts"),
      "utf8",
    );
    expect(seasonRelated).toMatch(/Open Burndown/);
    expect(seasonRelated).toMatch(/Open Goals/);
    expect(seasonRelated).toMatch(/Goals/);
    expect(seasonRelated).toMatch(/Choose your team/);
    expect(seasonRelated).not.toMatch(/\bPick a team\b/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/skills-graph"\)\) return "Skills"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/risks"\)\) return "Risk register"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/build-burndown"\)\) return "Burndown"/);
  });
});
