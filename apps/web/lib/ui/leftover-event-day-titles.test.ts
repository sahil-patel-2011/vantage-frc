import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Districts / Rank projection / Day plan /
 * Drive-team board / Charge plan titles after leftover-scout-titles.
 * Hub labels stay Districts, Rank projection, Day plan,
 * Drive-team board, and Charge plan. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/district-advancement/district-advancement-client.tsx",
  "app/district-advancement/page.tsx",
  "lib/manifests/district-advancement.manifest.ts",
  "app/ranking-projection/ranking-projection-client.tsx",
  "app/ranking-projection/page.tsx",
  "lib/manifests/ranking-projection.manifest.ts",
  "app/event-day-plan/event-day-plan-client.tsx",
  "app/event-day-plan/page.tsx",
  "lib/event-day-plan/event-day-plan-related.ts",
  "lib/manifests/event-day-plan.manifest.ts",
  "app/drive-team-signals/drive-team-signals-client.tsx",
  "app/drive-team-signals/page.tsx",
  "lib/drive-team-signals/drive-team-signals-related.ts",
  "lib/manifests/drive-team-signals.manifest.ts",
  "app/battery-rotation/battery-rotation-client.tsx",
  "app/battery-rotation/page.tsx",
  "lib/battery-rotation/battery-rotation-related.ts",
  "lib/manifests/battery-rotation.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student event-day-title chrome", () => {
  it("does not print leftover Planner / Signal Board / Rotation titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/District advancement/);
      expect(src, rel).not.toMatch(/District Advancement/);
      expect(src, rel).not.toMatch(/Ranking projection/);
      expect(src, rel).not.toMatch(/Ranking Projection/);
      expect(src, rel).not.toMatch(/Event-Day Stress Planner/);
      expect(src, rel).not.toMatch(/Event-Day Plan/);
      expect(src, rel).not.toMatch(/Event-day plan/);
      expect(src, rel).not.toMatch(/Drive-Team Signal Board/);
      expect(src, rel).not.toMatch(/Drive-Team Signals/);
      expect(src, rel).not.toMatch(/Drive-team signal board/);
      expect(src, rel).not.toMatch(/Drive-team signals/);
      expect(src, rel).not.toMatch(/Battery Rotation & Charge Planner/);
      expect(src, rel).not.toMatch(/Battery rotation & charge planner/);
      expect(src, rel).not.toMatch(/Battery Rotation/);
    }
    const districts = readFileSync(
      join(WEB, "app/district-advancement/district-advancement-client.tsx"),
      "utf8",
    );
    expect(districts).toMatch(/title="Districts"/);
    expect(districts).toMatch(/feature="Districts"/);
    const rank = readFileSync(
      join(WEB, "app/ranking-projection/ranking-projection-client.tsx"),
      "utf8",
    );
    expect(rank).toMatch(/title="Rank projection"/);
    expect(rank).toMatch(/feature="Rank projection"/);
    const day = readFileSync(join(WEB, "app/event-day-plan/event-day-plan-client.tsx"), "utf8");
    expect(day).toMatch(/title="Day plan"/);
    expect(day).toMatch(/feature="Day plan"/);
    expect(day).not.toMatch(/title="Loading/);
    const board = readFileSync(
      join(WEB, "app/drive-team-signals/drive-team-signals-client.tsx"),
      "utf8",
    );
    expect(board).toMatch(/title="Drive-team board"/);
    expect(board).toMatch(/feature="Drive-team board"/);
    const charge = readFileSync(
      join(WEB, "app/battery-rotation/battery-rotation-client.tsx"),
      "utf8",
    );
    expect(charge).toMatch(/title="Charge plan"/);
    expect(charge).toMatch(/feature="Charge plan"/);
  });
});
