import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-money. Hub labels stay Kickoff, Match debrief, Data quality,
 * and Pit link. leftover-debrief extras, leftover-scout-titles Data
 * quality / Pit link extras, leftover-opening-releases Opening Kickoff
 * on kickoff-intelligence stay. leftover-opening-money Opening Season
 * costs, leftover-opening-notebook Opening Engineering notebook,
 * leftover-pick-before Choose your team, leftover-fmea Failure log
 * stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B
 * stays. leftover-types comments in lib/kickoff.ts stay.
 * leftover-offline extras and leftover-hub extras stay off these FILES.
 * leftover-safety Safety incidents stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/kickoff/kickoff-client.tsx",
  "app/kickoff/page.tsx",
  "app/match-debrief/match-debrief-client.tsx",
  "app/data-quality-scorecard/data-quality-scorecard-client.tsx",
  "app/scout-p2p-relay/scout-p2p-relay-client.tsx",
] as const;

describe("leftover student opening-debrief chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Kickoff & Game Analysis/);
      expect(src, rel).not.toMatch(/Data Quality Scorecard/);
      expect(src, rel).not.toMatch(/Pit mesh/);
    }
    const kickoff = readFileSync(join(WEB, "app/kickoff/kickoff-client.tsx"), "utf8");
    expect(kickoff).toMatch(/Opening Kickoff/);
    expect(kickoff).toMatch(/title="Kickoff"/);
    expect(kickoff).toMatch(/feature="Kickoff"/);
    expect(kickoff).toMatch(/Choose your team/);
    const kickoffPage = readFileSync(join(WEB, "app/kickoff/page.tsx"), "utf8");
    expect(kickoffPage).toMatch(/title: "Kickoff"/);
    const debrief = readFileSync(join(WEB, "app/match-debrief/match-debrief-client.tsx"), "utf8");
    expect(debrief).toMatch(/Opening Match debrief/);
    expect(debrief).toMatch(/title="Match debrief"/);
    expect(debrief).toMatch(/feature="Match debrief"/);
    const quality = readFileSync(
      join(WEB, "app/data-quality-scorecard/data-quality-scorecard-client.tsx"),
      "utf8",
    );
    expect(quality).toMatch(/Opening Data quality/);
    expect(quality).toMatch(/title="Data quality"/);
    expect(quality).toMatch(/feature="Data quality"/);
    const pit = readFileSync(join(WEB, "app/scout-p2p-relay/scout-p2p-relay-client.tsx"), "utf8");
    expect(pit).toMatch(/Opening Pit link/);
    expect(pit).toMatch(/title="Pit link"/);
    expect(pit).toMatch(/feature="Pit link"/);
  });
});
