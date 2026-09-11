/**
 * Remaining inbox student chrome after last-snapshot already landed.
 * Team people/admin stays on main — not redone here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PREF_LABELS, EMAIL_PREF_LABELS } from "../../app/account/account-types";
import { notificationNextActions, notificationRelatedLinks } from "../notifications";
import { notificationTypeLabel } from "../notifications/format";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const FILES = [
  "app/notifications/notifications-client.tsx",
  "app/notifications/preferences/preferences-client.tsx",
  "app/account/account-notifications-panel.tsx",
  "app/account/account-types.ts",
  "lib/notifications/notifications-related.ts",
  "app/api/notifications/preferences/route.ts",
] as const;

describe("inbox remaining student chrome", () => {
  it("does not print leftover engineering copy on the inbox family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/Sponsor CRM/);
      expect(src, rel).not.toMatch(/TBA\/reference/);
      expect(src, rel).not.toMatch(/live TBA data/);
      expect(src, rel).not.toMatch(/ingest health/);
      expect(src, rel).not.toMatch(/coach→member/);
      expect(src, rel).not.toMatch(/Notification prefs/);
    }
  });

  it("empty inbox has no next-actions wall; unread empty is one Show all primary", () => {
    expect(notificationNextActions({ itemCount: 0, unreadCount: 0 })).toEqual([]);
    const client = readFileSync(join(WEB, "app/notifications/notifications-client.tsx"), "utf8");
    expect(client).not.toMatch(/<(?:[A-Z][A-Za-z0-9]*)?NextActions\b/);
    expect(client).toMatch(/Show all/);
    expect(client).toMatch(/if \(!view\)/);
    expect(client).not.toMatch(/fetchFailed \|\| !view/);
    expect(client).toMatch(/getFeatureSnapshot/);
    expect(client).toMatch(/putFeatureSnapshot/);
    const prefs = readFileSync(
      join(WEB, "app/notifications/preferences/preferences-client.tsx"),
      "utf8",
    );
    expect(prefs).toMatch(/if \(!view\)/);
    expect(prefs).not.toMatch(/fetchFailed \|\| !view/);
    expect(prefs).toMatch(/clearFeatureSnapshot/);
    expect(prefs).toMatch(/Needs setup/);
    const panel = readFileSync(join(WEB, "app/account/account-notifications-panel.tsx"), "utf8");
    expect(panel).toMatch(/variant="primary"/);
    expect(panel).toMatch(/Needs setup/);
  });

  it("related strip and pref details stay student-readable", () => {
    const links = notificationRelatedLinks();
    expect(links.find((l) => l.id === "preferences")?.label).toBe("Preferences");
    for (const item of PREF_LABELS) {
      expectPlainCopy(item.detail);
      expect(item.title).not.toMatch(/CRM/);
      expect(item.detail).not.toMatch(/\bTBA\b/);
    }
    for (const item of EMAIL_PREF_LABELS) {
      expectPlainCopy(item.detail);
      expect(item.detail).not.toMatch(/\bCRM\b/);
    }
    expect(notificationTypeLabel("todo_assigned")).toBe("Todo");
    expect(notificationTypeLabel("scouting_coverage_gap")).toBe("Scouting");
    expect(notificationTypeLabel("todo_assigned")).not.toMatch(/_/);
  });
});
