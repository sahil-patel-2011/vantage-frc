import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help compound titles after leftover help-compound.
 * Team hub / Your AI keys / Spend limits / Owner guide drop leftover
 * Calendar, Chat, People, Work, and Playbook / Your AI keys and Automode /
 * Hosted credits, pay-as-you-go, and spend limits / Owner & admin guide
 * titles. leftover-help-compound Event day / Alliance desk / Connect TBA /
 * Import from other tools extras stay. leftover-help-emdash extras stay.
 * leftover-help extras, leftover-invites extras, leftover-hub-help extras,
 * leftover-pick-before extras, leftover-community-impact extras,
 * leftover-event-day-more extras stay. leftover-student-emdash extras stay
 * off these FILES. leftover-media extras stay: Drive folder names stay
 * Media Library; do not ban Media Library on these FILES. leftover-offline
 * extras and leftover-hub extras stay off these FILES. leftover-hub
 * Calendar / Chat / People / Work / Playbook stay. leftover-product extras
 * stay off these FILES. leftover-opening-mismatch Opening Blueprint,
 * leftover-pick-before Choose your team, leftover-fmea Failure log stay.
 * leftover-admin skip-list Global Team Manager stays. leftover-my-day
 * Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * leftover-safety Safety incidents stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = ["lib/help/articles.ts"] as const;

describe("leftover student help-compound-more chrome", () => {
  it("does not print leftover Help compound titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title: "Calendar, Chat, People/);
      expect(src, rel).not.toMatch(/title: "Your AI keys and Automode"/);
      expect(src, rel).not.toMatch(/title: "Hosted credits, pay-as-you-go/);
      expect(src, rel).not.toMatch(/title: "Owner & admin guide"/);
      expect(src, rel).not.toMatch(/Event Day/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Team hub"/);
    expect(articles).toMatch(/title: "Your AI keys"/);
    expect(articles).toMatch(/title: "Spend limits"/);
    expect(articles).toMatch(/title: "Owner guide"/);
    expect(articles).toMatch(/title: "Event day"/);
    expect(articles).toMatch(/title: "Alliance desk"/);
    expect(articles).toMatch(/title: "Connect TBA"/);
    expect(articles).toMatch(/title: "Import from other tools"/);
    expect(articles).toMatch(/title: "Ask AI"/);
    expect(articles).toMatch(/title: "AI subscription bridge"/);
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    expect(articles).toMatch(/Media Library/);
  });
});
