import { describe, expect, it } from "vitest";
import { eventDayNextActions } from "./event-day-actions";
import { buildScoutQueue, scoutQueueSummary, type UpcomingAllianceTeam } from "./scout-queue";
import type { CommandSnapshot } from "./types";

/*
  UX-12: Event day said "2 need a pit visit" over five rows that all said "Needs a pit visit".
  The heading only counted robots that already had match reports.
*/

const upcoming = (teamKey: string, slot: UpcomingAllianceTeam["slot"], matchIndex = 0): UpcomingAllianceTeam => ({
  teamKey, slot, matchIndex, matchKey: `2026test_qm${31 + matchIndex}`, compLevel: "qm", matchNumber: 31 + matchIndex, scheduledTime: null,
});

// Our next match: us (254) with two partners, against three opponents. Three robots have never
// been match scouted, two have; none has had a pit visit.
const queue = buildScoutQueue({
  ourTeamKey: "frc254",
  orgId: "org",
  upcoming: [
    upcoming("frc254", "us"),
    upcoming("frc1323", "partner"),
    upcoming("frc7457", "partner"),
    upcoming("frc118", "opponent"),
    upcoming("frc2481", "opponent"),
    upcoming("frc3005", "opponent"),
  ],
  coverage: [
    { teamKey: "frc254", matchReports: 0, pitReports: 0 },
    { teamKey: "frc1323", matchReports: 3, pitReports: 0 },
    { teamKey: "frc7457", matchReports: 2, pitReports: 0 },
    { teamKey: "frc118", matchReports: 0, pitReports: 0 },
    { teamKey: "frc2481", matchReports: 0, pitReports: 0 },
    { teamKey: "frc3005", matchReports: 0, pitReports: 0 },
  ],
});
// What each row prints: Event day shows the first two reasons.
const printed = queue.map((item) => item.reasons.slice(0, 2));

describe("Scout next heading agrees with its rows", () => {
  it("counts every row that says it needs a pit visit, not only the match-scouted ones", () => {
    expect(queue).toHaveLength(5);
    expect(printed.filter((reasons) => reasons.includes("Needs a pit visit"))).toHaveLength(5);
    expect(printed.filter((reasons) => reasons.includes("Needs match scouting"))).toHaveLength(3);
    expect(scoutQueueSummary(queue)).toBe("3 need match scouting · 5 need a pit visit");
  });

  it("never lists or counts our own robot", () => {
    expect(queue.map((item) => item.teamKey)).not.toContain("frc254");
  });

  it("says one robot in the singular, and names the rest when no gap of either kind applies", () => {
    expect(scoutQueueSummary([{ hasMatchScout: true, hasPitScout: false }])).toBe("1 needs a pit visit");
    expect(scoutQueueSummary([{ hasMatchScout: false, hasPitScout: true }])).toBe("1 needs match scouting");
    // On the list for a second match report only.
    expect(scoutQueueSummary([{ hasMatchScout: true, hasPitScout: true }, { hasMatchScout: true, hasPitScout: true }])).toBe("2 to check");
    expect(scoutQueueSummary([])).toBe("Nothing waiting");
  });
});

describe("Event day next action counts the same queue", () => {
  it("does not say 'Scout 0 coverage gaps' when every gap is a pit visit", () => {
    const snap = {
      orgId: "org-1",
      eventKey: "2026test",
      matches: [],
      scoutQueue: queue.filter((item) => item.hasMatchScout).map((item) => ({ ...item, formHref: "/scouting" })),
      prediction: { status: "empty" },
      myDay: null,
      links: {},
      coverage: { upcomingUnscouted: 0 },
    } as unknown as CommandSnapshot;
    expect(eventDayNextActions(snap, { orgId: "org-1" }).find((action) => action.id === "scout")?.label).toBe("Scout 2 coverage gaps");
  });
});
