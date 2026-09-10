import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_RELATED_INCLUDE,
  notificationNextActions,
  notificationReadLabel,
  notificationReadTone,
  notificationRelatedLinks,
} from "./notifications-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("notifications Soft-UI helpers", () => {
  it("builds What’s new / Support / Account / prefs cross-links", () => {
    const links = notificationRelatedLinks({ include: [...NOTIFICATION_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["whats-new", "support", "account", "preferences"]);
    expect(links.find((l) => l.id === "whats-new")?.href).toBe("/whats-new");
    expect(links.find((l) => l.id === "support")?.href).toBe("/support");
    expect(links.find((l) => l.id === "account")?.href).toBe("/account");
    expect(links.find((l) => l.id === "preferences")?.href).toBe("/notifications/preferences");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("omits the active surface from the strip", () => {
    const links = notificationRelatedLinks({
      include: [...NOTIFICATION_RELATED_INCLUDE],
      active: "preferences",
    });
    expect(links.map((l) => l.id)).toEqual(["whats-new", "support", "account"]);
  });

  it("asks for real events when empty — never DEMO notifications", () => {
    const actions = notificationNextActions({ itemCount: 0, unreadCount: 0 });
    expect(actions[0]?.id).toBe("empty");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toContain("preferences");
    expect(actions.map((a) => a.id)).toContain("whats-new");
    expect(actions.map((a) => a.id)).toContain("support");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    actions.forEach((a) => expectPlainCopy(a.detail));
  });

  it("clarifies unread-empty vs all-empty", () => {
    const unreadEmpty = notificationNextActions({
      itemCount: 0,
      unreadCount: 0,
      filter: "unread",
    });
    expect(unreadEmpty[0]?.id).toBe("caught-up");
    expect(unreadEmpty.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("prioritizes mark-as-read when unread exists", () => {
    const actions = notificationNextActions({ itemCount: 4, unreadCount: 2 });
    expect(actions[0]?.id).toBe("mark-read");
    expect(actions[0]?.label).toMatch(/Mark 2 as read/);
    expect(actions[0]?.primary).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("maps read labels and tones without DEMO", () => {
    expect(notificationReadLabel(null)).toBe("Unread");
    expect(notificationReadLabel("2026-07-18T12:00:00.000Z")).toBe("Read");
    expect(notificationReadTone(null)).toBe("setup");
    expect(notificationReadTone("2026-07-18T12:00:00.000Z")).toBe("good");
  });
});
