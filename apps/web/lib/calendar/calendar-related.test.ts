import { describe, expect, it } from "vitest";
import {
  CALENDAR_TEAM_RELATED_INCLUDE,
  calendarNextActions,
  calendarOpsRelatedLinks,
  monthEventCountLabel,
  monthEventPeek,
} from "./calendar-related";
import { teamHubRelatedLinks } from "../team/team-related";

describe("calendar Soft-UI helpers", () => {
  it("exposes Practice / Attendance / Messages in the Team strip", () => {
    expect(CALENDAR_TEAM_RELATED_INCLUDE).toEqual(["practice", "attendance", "messages"]);
    const links = teamHubRelatedLinks("org-1", {
      active: "calendar",
      include: CALENDAR_TEAM_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["practice", "attendance", "messages"]);
    expect(links.every((l) => l.href.includes("orgId=org-1"))).toBe(true);
  });

  it("adds Logistics as an ops cross-link", () => {
    expect(calendarOpsRelatedLinks("org-1").map((l) => l.href)).toEqual([
      "/logistics?orgId=org-1",
    ]);
  });

  it("builds month peeks from real titles only", () => {
    expect(monthEventPeek(["Shop night", "Deadline", "Meeting", "Extra"])).toEqual({
      peeks: ["Shop night", "Deadline", "Meeting"],
      overflow: 1,
    });
    expect(monthEventCountLabel(0)).toBeNull();
    expect(monthEventCountLabel(3)).toBe("3");
  });

  it("next actions for empty teams — never DEMO events", () => {
    const setup = calendarNextActions({
      orgId: "org-1",
      subteamCount: 0,
      eventCount: 0,
      canManage: true,
    });
    expect(setup[0]?.id).toBe("first-subteam");
    expect(setup.every((a) => !/\bdemo event\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(setup.every((a) => !a.href.includes("demo"))).toBe(true);

    const noEvents = calendarNextActions({
      orgId: "org-1",
      subteamCount: 2,
      eventCount: 0,
      canManage: true,
    });
    expect(noEvents.map((a) => a.id)).toEqual(
      expect.arrayContaining(["first-event", "attendance", "practice", "logistics"]),
    );

    const ready = calendarNextActions({
      orgId: "org-1",
      subteamCount: 2,
      eventCount: 4,
      canManage: false,
    });
    expect(ready.map((a) => a.id)).toEqual(["practice", "attendance", "logistics", "messages"]);
  });

  it("workspace gate when org is missing", () => {
    expect(calendarNextActions({ orgId: null, subteamCount: 0, eventCount: 0, canManage: false })[0]?.href).toBe(
      "/workspace",
    );
  });
});
