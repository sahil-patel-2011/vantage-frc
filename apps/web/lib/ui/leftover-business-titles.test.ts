import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Award tracker / Sponsor suite / Sponsor wall /
 * Outreach calendar / Team health titles after leftover-people-titles.
 * Hub labels stay Award tracker, Sponsor suite, Sponsor wall,
 * Outreach calendar, and Team health. leftover-business-more
 * Eligibility / Renewal ROI / Tier calculator / Season costs / Mock
 * judging stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/award-tracker/award-tracker-client.tsx",
  "app/award-tracker/page.tsx",
  "lib/award-tracker/award-tracker-related.ts",
  "lib/manifests/award-tracker.manifest.ts",
  "app/sponsor-suite/sponsor-suite-client.tsx",
  "app/sponsor-suite/page.tsx",
  "lib/sponsor-suite/sponsor-suite-related.ts",
  "lib/manifests/sponsor-suite.manifest.ts",
  "app/sponsor-wall/sponsor-wall-client.tsx",
  "app/sponsor-wall/page.tsx",
  "lib/sponsor-wall/sponsor-wall-related.ts",
  "lib/manifests/sponsor-wall.manifest.ts",
  "app/outreach-calendar/outreach-calendar-client.tsx",
  "app/outreach-calendar/page.tsx",
  "lib/outreach-calendar/outreach-calendar-related.ts",
  "lib/manifests/outreach-calendar.manifest.ts",
  "app/team-health-dashboard/team-health-dashboard-client.tsx",
  "app/team-health-dashboard/page.tsx",
  "lib/team-health/related.ts",
  "lib/manifests/team-health-dashboard.manifest.ts",
  "lib/hours-self-view/hours-self-view-related.ts",
  "lib/media/media-related.ts",
  "lib/media-kit/media-kit-related.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student business-title chrome", () => {
  it("does not print leftover Tracker / Suite / Wall / Calendar titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Award Tracker/);
      expect(src, rel).not.toMatch(/Award Submission Tracker/);
      expect(src, rel).not.toMatch(/Sponsor Suite/);
      expect(src, rel).not.toMatch(/Sponsor Wall/);
      expect(src, rel).not.toMatch(/Outreach Calendar/);
      expect(src, rel).not.toMatch(/Team Health Dashboard/);
      expect(src, rel).not.toMatch(/Team Health/);
    }
    const award = readFileSync(join(WEB, "app/award-tracker/award-tracker-client.tsx"), "utf8");
    expect(award).toMatch(/title="Award tracker"/);
    expect(award).toMatch(/feature="Award tracker"/);
    const suite = readFileSync(join(WEB, "app/sponsor-suite/sponsor-suite-client.tsx"), "utf8");
    expect(suite).toMatch(/title="Sponsor suite"/);
    expect(suite).toMatch(/feature="Sponsor suite"/);
    const wall = readFileSync(join(WEB, "app/sponsor-wall/sponsor-wall-client.tsx"), "utf8");
    expect(wall).toMatch(/title="Sponsor wall"/);
    expect(wall).toMatch(/feature="Sponsor wall"/);
    const outreach = readFileSync(
      join(WEB, "app/outreach-calendar/outreach-calendar-client.tsx"),
      "utf8",
    );
    expect(outreach).toMatch(/title="Outreach calendar"/);
    expect(outreach).toMatch(/feature="Outreach calendar"/);
    const health = readFileSync(
      join(WEB, "app/team-health-dashboard/team-health-dashboard-client.tsx"),
      "utf8",
    );
    expect(health).toMatch(/title="Team health"/);
    expect(health).toMatch(/feature="Team health"/);
    const related = readFileSync(join(WEB, "lib/award-tracker/award-tracker-related.ts"), "utf8");
    expect(related).toMatch(/Opening Award tracker/);
    expect(related).not.toMatch(/title="Loading/);
  });
});
