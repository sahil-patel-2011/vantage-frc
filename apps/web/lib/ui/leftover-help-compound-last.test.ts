import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help compound titles after leftover help-compound-rest.
 * Bottom island / Hub access / Season finance / Team funding drop leftover
 * Customize the bottom island / Limit hub access for scouts and viewers /
 * Season finance desk / Team funding profile and sponsor tools titles.
 * leftover-help-compound extras stay. leftover-help-compound-more extras
 * stay. leftover-help-compound-rest Scouting / Storage node / Pair an AI
 * relay / Media team extras stay. leftover-help-emdash extras stay.
 * leftover-help extras, leftover-invites extras, leftover-hub-help extras,
 * leftover-pick-before extras, leftover-community-impact extras,
 * leftover-event-day-more extras stay. leftover-student-emdash extras stay
 * off these FILES. leftover-opening-security Opening hub access extras
 * stay off these FILES. leftover-media extras stay: Drive folder names
 * stay Media Library; do not ban Media Library on these FILES.
 * leftover-offline extras and leftover-hub extras stay off these FILES.
 * leftover-product extras stay off these FILES. leftover-opening-mismatch
 * Opening Blueprint, leftover-pick-before Choose your team, leftover-fmea
 * Failure log stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * leftover-safety Safety incidents stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-compound-last chrome", () => {
  it("does not print leftover Help compound titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "Customize the bottom island"/);
      expect(src, rel).not.toMatch(/title: "Limit hub access/);
      expect(src, rel).not.toMatch(/title: "Season finance desk"/);
      expect(src, rel).not.toMatch(/title: "Team funding profile/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Bottom island"/);
    expect(articles).toMatch(/title: "Hub access"/);
    expect(articles).toMatch(/title: "Season finance"/);
    expect(articles).toMatch(/title: "Team funding"/);
    expect(articles).toMatch(/title: "Scouting"/);
    expect(articles).toMatch(/title: "Storage node"/);
    expect(articles).toMatch(/title: "Pair an AI relay"/);
    expect(articles).toMatch(/title: "Media team"/);
    expect(articles).toMatch(/title: "Event day"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
