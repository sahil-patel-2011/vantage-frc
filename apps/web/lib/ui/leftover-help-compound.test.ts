import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help compound titles after leftover help-emdash-last
 * and leftover-student-emdash. Event day / Alliance desk / Connect TBA /
 * Import from other tools drop leftover Event day and Command / Alliance
 * desk and Season plan / Connect TBA, Onshape, GitHub, and chat / Import
 * from other tools (Bring your season) titles. leftover-help-emdash extras
 * stay. leftover-help-emdash-more extras, leftover-help-emdash-rest extras,
 * leftover-help-emdash-last extras stay. leftover-student-emdash extras
 * stay off these FILES. leftover-help extras, leftover-invites extras,
 * leftover-hub-help extras, leftover-pick-before extras,
 * leftover-community-impact extras, leftover-event-day-more extras stay.
 * leftover-media extras stay: Drive folder names stay Media Library; do
 * not ban Media Library on these FILES. leftover-offline extras and
 * leftover-hub extras stay off these FILES. leftover-opening-mismatch
 * Opening Blueprint, leftover-pick-before Choose your team, leftover-fmea
 * Failure log stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * leftover-safety Safety incidents stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-compound chrome", () => {
  it("does not print leftover Help compound titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "Event day and Command"/);
      expect(src, rel).not.toMatch(/title: "Alliance desk and Season plan"/);
      expect(src, rel).not.toMatch(/title: "Connect TBA, Onshape/);
      expect(src, rel).not.toMatch(/title: "Import from other tools \(/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Event day"/);
    expect(articles).toMatch(/title: "Alliance desk"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/title: "Import from other tools"/);
    expect(articles).toMatch(/title: "Ask AI"/);
    expect(articles).toMatch(/title: "Files"/);
    expect(articles).toMatch(/title: "Team library"/);
    expect(articles).toMatch(/title: "Media library"/);
    expect(articles).toMatch(/title: "Team profile"/);
    expect(articles).toMatch(/title: "Edit Home"/);
    expect(articles).toMatch(/title: "AI subscription bridge"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
