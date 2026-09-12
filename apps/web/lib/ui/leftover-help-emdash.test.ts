import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help Title-Case em-dash titles after leftover
 * opening-mismatch. Ask AI / Files / Team library / Media library drop
 * leftover Ask AI — / Files — / Team Library — / Media library — titles.
 * leftover-help extras, leftover-invites extras, leftover-hub-help extras,
 * leftover-pick-before extras, leftover-community-impact extras,
 * leftover-event-day-more extras stay. leftover-media extras stay: Drive
 * folder names stay Media Library; do not ban Media Library on these
 * FILES. leftover-opening-mismatch Opening Blueprint, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-offline extras and
 * leftover-hub extras stay off these FILES. leftover-safety Safety
 * incidents stays. Routes stay. Do not invent a last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-emdash chrome", () => {
  it("does not print leftover Help Title-Case em-dash titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "Ask AI —/);
      expect(src, rel).not.toMatch(/title: "Files —/);
      expect(src, rel).not.toMatch(/title: "Team Library —/);
      expect(src, rel).not.toMatch(/title: "Media library —/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Ask AI"/);
    expect(articles).toMatch(/title: "Files"/);
    expect(articles).toMatch(/title: "Team library"/);
    expect(articles).toMatch(/title: "Media library"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
