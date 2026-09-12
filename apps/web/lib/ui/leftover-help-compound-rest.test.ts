import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help compound titles after leftover help-compound-more.
 * Scouting / Storage node / Pair an AI relay / Media team drop leftover
 * Scouting and offline / Self-hosted storage node / Pair an AI relay
 * (Raspberry Pi) / Media team for press and business titles.
 * leftover-help-compound Event day / Alliance desk / Connect TBA /
 * Import from other tools extras stay. leftover-help-compound-more Team
 * hub / Your AI keys / Spend limits / Owner guide extras stay.
 * leftover-help-emdash extras stay. leftover-help extras, leftover-invites
 * extras, leftover-hub-help extras, leftover-pick-before extras,
 * leftover-community-impact extras, leftover-event-day-more extras stay.
 * leftover-student-emdash extras stay off these FILES. leftover-media
 * extras stay: Drive folder names stay Media Library; do not ban Media
 * Library on these FILES. leftover-offline extras and leftover-hub extras
 * stay off these FILES. leftover-hub Scouting stays. leftover-hub Media
 * library stays. leftover-product extras stay off these FILES.
 * leftover-opening-mismatch Opening Blueprint, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-safety Safety
 * incidents stays. Routes stay. Do not invent a last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-compound-rest chrome", () => {
  it("does not print leftover Help compound titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "Scouting and offline"/);
      expect(src, rel).not.toMatch(/title: "Self-hosted storage node"/);
      expect(src, rel).not.toMatch(/title: "Pair an AI relay \(/);
      expect(src, rel).not.toMatch(/title: "Media team for press/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Scouting"/);
    expect(articles).toMatch(/title: "Storage node"/);
    expect(articles).toMatch(/title: "Pair an AI relay"/);
    expect(articles).toMatch(/title: "Media team"/);
    expect(articles).toMatch(/title: "Team hub"/);
    expect(articles).toMatch(/title: "Event day"/);
    expect(articles).toMatch(/title: "Alliance desk"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/title: "Ask AI"/);
    expect(articles).toMatch(/title: "AI subscription bridge"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
