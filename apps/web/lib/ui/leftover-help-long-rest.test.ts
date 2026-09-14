import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help long titles after leftover help-long-more. Funding /
 * Packing lists / Battery logs / Shop without signal drop leftover How the
 * team is funded / Packing lists at the event / Battery logs in the pit /
 * Using the shop without signal titles. leftover-help-long extras stay.
 * leftover-help-long-more extras stay. leftover-help-compound extras stay.
 * leftover-help-emdash extras stay. leftover-help extras, leftover-invites
 * extras, leftover-hub-help extras, leftover-pick-before extras,
 * leftover-community-impact extras, leftover-event-day-more extras stay.
 * leftover-opening-people Opening Team setup extras stay off these FILES.
 * leftover-cad extras stay off these FILES. leftover-student-emdash extras
 * stay off these FILES. leftover-media extras stay: Drive folder names stay
 * Media Library; do not ban Media Library on these FILES. leftover-offline
 * extras and leftover-hub extras stay off these FILES. leftover-hub Match
 * video stays. leftover-product extras stay off these FILES.
 * leftover-opening-mismatch Opening Blueprint, leftover-pick-before Choose
 * your team, leftover-fmea Failure log stay. leftover-admin skip-list
 * Global Team Manager stays. leftover-my-day Loading My Day stays (hub My
 * Day). Hub Schema A/B stays. leftover-safety Safety incidents stays.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-long-rest chrome", () => {
  it("does not print leftover Help long titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "How the team is funded"/);
      expect(src, rel).not.toMatch(/title: "Packing lists at the event"/);
      expect(src, rel).not.toMatch(/title: "Battery logs in the pit"/);
      expect(src, rel).not.toMatch(/title: "Using the shop without signal"/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Funding"/);
    expect(articles).toMatch(/title: "Packing lists"/);
    expect(articles).toMatch(/title: "Battery logs"/);
    expect(articles).toMatch(/title: "Shop without signal"/);
    expect(articles).toMatch(/title: "Team funding"/);
    expect(articles).toMatch(/title: "Scan GitHub"/);
    expect(articles).toMatch(/title: "Event day"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
