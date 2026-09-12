import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help long titles after leftover help-compound-last.
 * Team setup / Outreach hours / Naming CAD parts / Invites drop leftover
 * Set up a new team, start to first event / Outreach hours by person /
 * Naming CAD parts so the next person can find them / Invite teammates
 * by email titles. leftover-help-compound extras stay.
 * leftover-help-compound-more extras stay. leftover-help-compound-rest
 * extras stay. leftover-help-compound-last extras stay.
 * leftover-help-emdash extras stay. leftover-help extras, leftover-invites
 * extras, leftover-hub-help extras, leftover-pick-before extras,
 * leftover-community-impact extras, leftover-event-day-more extras stay.
 * leftover-opening-people Opening Team setup extras stay off these FILES.
 * leftover-people-titles Team setup extras stay off these FILES.
 * leftover-cad extras stay off these FILES. leftover-student-emdash extras
 * stay off these FILES. leftover-media extras stay: Drive folder names
 * stay Media Library; do not ban Media Library on these FILES.
 * leftover-offline extras and leftover-hub extras stay off these FILES.
 * leftover-opening-mismatch Opening Blueprint, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-safety Safety
 * incidents stays. Routes stay. Do not invent a last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-long chrome", () => {
  it("does not print leftover Help long titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "Set up a new team,/);
      expect(src, rel).not.toMatch(/title: "Outreach hours by person"/);
      expect(src, rel).not.toMatch(/title: "Naming CAD parts so the next person/);
      expect(src, rel).not.toMatch(/title: "Invite teammates by email"/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Team setup"/);
    expect(articles).toMatch(/title: "Outreach hours"/);
    expect(articles).toMatch(/title: "Naming CAD parts"/);
    expect(articles).toMatch(/title: "Invites"/);
    expect(articles).toMatch(/title: "Bottom island"/);
    expect(articles).toMatch(/title: "Scouting"/);
    expect(articles).toMatch(/title: "Event day"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
