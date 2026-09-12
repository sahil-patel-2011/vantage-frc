import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Leadership / Pit map / Decision notes / Checklists /
 * My hours / Team setup titles after leftover-event-day-titles.
 * Hub labels stay Leadership, Pit map, Decision notes, Checklists,
 * My hours, and Team setup. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/leadership/leadership-client.tsx",
  "app/leadership/page.tsx",
  "lib/leadership/leadership-related.ts",
  "lib/manifests/leadership.manifest.ts",
  "app/pit-map-planner/pit-map-planner-client.tsx",
  "app/pit-map-planner/page.tsx",
  "lib/manifests/pit-map-planner.manifest.ts",
  "app/decisions/decisions-client.tsx",
  "app/decisions/page.tsx",
  "lib/decisions/decisions-related.ts",
  "app/checklist-library/checklist-library-client.tsx",
  "app/checklist-library/page.tsx",
  "lib/manifests/checklist-library.manifest.ts",
  "app/hours-self-view/hours-self-view-client.tsx",
  "app/hours-self-view/page.tsx",
  "lib/hours-self-view/hours-self-view-related.ts",
  "lib/manifests/hours-self-view.manifest.ts",
  "app/team/getting-started/getting-started-client.tsx",
  "app/team/getting-started/page.tsx",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student people-title chrome", () => {
  it("does not print leftover Continuity / Planner / Library titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Leadership Continuity/);
      expect(src, rel).not.toMatch(/Pit Map Planner/);
      expect(src, rel).not.toMatch(/Decision Log/);
      expect(src, rel).not.toMatch(/Checklist Library/);
      expect(src, rel).not.toMatch(/My Hours/);
    }
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).not.toMatch(/return "Getting started"/);
    const lead = readFileSync(join(WEB, "app/leadership/leadership-client.tsx"), "utf8");
    expect(lead).toMatch(/title="Leadership"/);
    expect(lead).toMatch(/feature="Leadership"/);
    const pit = readFileSync(join(WEB, "app/pit-map-planner/pit-map-planner-client.tsx"), "utf8");
    expect(pit).toMatch(/title="Pit map"/);
    expect(pit).toMatch(/feature="Pit map"/);
    expect(pit).toMatch(/Opening Pit map/);
    expect(pit).not.toMatch(/title="Loading/);
    const notes = readFileSync(join(WEB, "app/decisions/decisions-client.tsx"), "utf8");
    expect(notes).toMatch(/title="Decision notes"/);
    expect(notes).toMatch(/feature="Decision notes"/);
    const lists = readFileSync(join(WEB, "app/checklist-library/checklist-library-client.tsx"), "utf8");
    expect(lists).toMatch(/title="Checklists"/);
    expect(lists).toMatch(/feature="Checklists"/);
    const hours = readFileSync(join(WEB, "app/hours-self-view/hours-self-view-client.tsx"), "utf8");
    expect(hours).toMatch(/title="My hours"/);
    expect(hours).toMatch(/feature="My hours"/);
    const setup = readFileSync(join(WEB, "app/team/getting-started/page.tsx"), "utf8");
    expect(setup).toMatch(/title="Team setup"/);
  });
});
