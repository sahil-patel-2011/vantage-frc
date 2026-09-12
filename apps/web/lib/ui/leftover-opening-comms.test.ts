import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-roles. Hub labels stay Discord, Support, Notifications, and
 * Notification preferences. leftover-student-buttons extras stay on
 * Discord / Support. leftover-opening-inbox Opening Chat stays.
 * leftover-opening-ops Opening Discord / Opening Support on related
 * stay. leftover-opening-roles Opening Season roles, leftover-opening-fmea
 * Opening Failure log, leftover-pick-before Choose your team,
 * leftover-fmea Failure log stay. leftover-admin skip-list Global Team
 * Manager stays. leftover-my-day Loading My Day stays (hub My Day). Hub
 * Schema A/B stays. leftover-offline extras and leftover-hub extras stay
 * off these FILES. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/team/discord/discord-client.tsx",
  "app/support/support-tickets-client.tsx",
  "app/notifications/notifications-client.tsx",
  "app/notifications/preferences/preferences-client.tsx",
] as const;

describe("leftover student opening-comms chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
    }
    const discord = readFileSync(join(WEB, "app/team/discord/discord-client.tsx"), "utf8");
    expect(discord).toMatch(/Opening Discord/);
    expect(discord).toMatch(/title="Discord"/);
    expect(discord).toMatch(/feature="Discord"/);
    const support = readFileSync(join(WEB, "app/support/support-tickets-client.tsx"), "utf8");
    expect(support).toMatch(/Opening Support/);
    expect(support).toMatch(/title="Support"/);
    expect(support).toMatch(/feature="Support"/);
    expect(support).toMatch(/Choose your team/);
    const inbox = readFileSync(join(WEB, "app/notifications/notifications-client.tsx"), "utf8");
    expect(inbox).toMatch(/Opening Notifications/);
    expect(inbox).toMatch(/title="Notifications"/);
    expect(inbox).toMatch(/feature="Notifications"/);
    expect(inbox).not.toMatch(/Loading inbox/);
    const prefs = readFileSync(
      join(WEB, "app/notifications/preferences/preferences-client.tsx"),
      "utf8",
    );
    expect(prefs).toMatch(/Opening Notification preferences/);
    expect(prefs).toMatch(/title="Notification preferences"/);
    expect(prefs).toMatch(/feature="Notification preferences"/);
    expect(prefs).not.toMatch(/Loading your inbox/);
    expect(prefs).not.toMatch(/Loading preferences/);
  });
});
