import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help long titles after leftover help-long. Scan GitHub /
 * Local AI / Plans / Paste a video drop leftover Scan GitHub with Bugbot /
 * Run Vantage on local or free AI / Plans: Free, Pro, Pro+, and Max /
 * Paste a match or pit video titles. leftover-help-long Team setup /
 * Outreach hours / Naming CAD parts / Invites extras stay.
 * leftover-help-compound extras stay. leftover-help-emdash extras stay.
 * leftover-help extras, leftover-invites extras, leftover-hub-help extras,
 * leftover-pick-before extras, leftover-community-impact extras,
 * leftover-event-day-more extras stay. leftover-opening-people Opening
 * Team setup extras stay off these FILES. leftover-cad extras stay off
 * these FILES. leftover-student-emdash extras stay off these FILES.
 * leftover-media extras stay: Drive folder names stay Media Library; do
 * not ban Media Library on these FILES. leftover-offline extras and
 * leftover-hub extras stay off these FILES. leftover-hub Match video
 * stays. leftover-product extras stay off these FILES.
 * leftover-opening-mismatch Opening Blueprint, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-safety Safety
 * incidents stays. Routes stay. Do not invent a last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-long-more chrome", () => {
  it("does not print leftover Help long titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "Scan GitHub with Bugbot"/);
      expect(src, rel).not.toMatch(/title: "Run Vantage on local or free AI"/);
      expect(src, rel).not.toMatch(/title: "Plans: Free,/);
      expect(src, rel).not.toMatch(/title: "Paste a match or pit video"/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Scan GitHub"/);
    expect(articles).toMatch(/title: "Local AI"/);
    expect(articles).toMatch(/title: "Plans"/);
    expect(articles).toMatch(/title: "Paste a video"/);
    expect(articles).toMatch(/title: "Team setup"/);
    expect(articles).toMatch(/title: "Invites"/);
    expect(articles).toMatch(/title: "Event day"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
