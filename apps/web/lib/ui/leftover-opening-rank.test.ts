import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-debrief. Hub labels stay Rank projection, Schema A/B,
 * Schedule, and Team profile. leftover-event-day-titles Rank
 * projection extras, leftover-rankings-tba extras, leftover-schedule-profile
 * extras stay. leftover-opening-debrief Opening Kickoff,
 * leftover-opening-money Opening Season costs, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays Title-Case.
 * leftover-offline extras and leftover-hub extras stay off these FILES.
 * leftover-safety Safety incidents stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/ranking-projection/ranking-projection-client.tsx",
  "app/scouting-schema-ab/scouting-schema-ab-client.tsx",
  "app/schedule/schedule-client.tsx",
  "app/team/profile/team-profile-client.tsx",
] as const;

describe("leftover student opening-rank chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Ranking projection/);
      expect(src, rel).not.toMatch(/Ranking Projection/);
      expect(src, rel).not.toMatch(/Match schedule/);
    }
    const rank = readFileSync(
      join(WEB, "app/ranking-projection/ranking-projection-client.tsx"),
      "utf8",
    );
    expect(rank).toMatch(/Opening Rank projection/);
    expect(rank).toMatch(/title="Rank projection"/);
    expect(rank).toMatch(/feature="Rank projection"/);
    const schema = readFileSync(
      join(WEB, "app/scouting-schema-ab/scouting-schema-ab-client.tsx"),
      "utf8",
    );
    expect(schema).toMatch(/Opening Schema A\/B/);
    expect(schema).toMatch(/title="Schema A\/B"/);
    expect(schema).toMatch(/feature="Schema A\/B"/);
    const schedule = readFileSync(join(WEB, "app/schedule/schedule-client.tsx"), "utf8");
    expect(schedule).toMatch(/Opening Schedule/);
    expect(schedule).toMatch(/<h1>Schedule<\/h1>/);
    expect(schedule).toMatch(/feature="Schedule"/);
    const profile = readFileSync(join(WEB, "app/team/profile/team-profile-client.tsx"), "utf8");
    expect(profile).toMatch(/Opening Team profile/);
    expect(profile).toMatch(/"Team profile"/);
    expect(profile).toMatch(/feature="Team profile"/);
  });
});
