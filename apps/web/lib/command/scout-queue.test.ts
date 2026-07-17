import { describe, expect, it } from "vitest";
import { buildScoutQueue, withScoutFormHrefs } from "./scout-queue";

describe("buildScoutQueue", () => {
  it("prioritizes unscounted next-match opponents over covered partners", () => {
    const queue = buildScoutQueue({
      ourTeamKey: "frc254",
      orgId: "org",
      upcoming: [
        {
          teamKey: "frc254",
          matchKey: "2026test_qm1",
          compLevel: "qm",
          matchNumber: 1,
          scheduledTime: null,
          slot: "us",
          matchIndex: 0,
        },
        {
          teamKey: "frc1678",
          matchKey: "2026test_qm1",
          compLevel: "qm",
          matchNumber: 1,
          scheduledTime: null,
          slot: "partner",
          matchIndex: 0,
        },
        {
          teamKey: "frc118",
          matchKey: "2026test_qm1",
          compLevel: "qm",
          matchNumber: 1,
          scheduledTime: null,
          slot: "opponent",
          matchIndex: 0,
        },
        {
          teamKey: "frc2056",
          matchKey: "2026test_qm8",
          compLevel: "qm",
          matchNumber: 8,
          scheduledTime: null,
          slot: "opponent",
          matchIndex: 1,
        },
      ],
      coverage: [
        { teamKey: "frc1678", matchReports: 3, pitReports: 1 },
        { teamKey: "frc118", matchReports: 0, pitReports: 0 },
        { teamKey: "frc2056", matchReports: 0, pitReports: 0 },
      ],
    });

    expect(queue[0]?.teamKey).toBe("frc118");
    expect(queue[0]?.reasons.some((r) => /No match scout/i.test(r))).toBe(true);
    expect(queue.map((item) => item.teamKey)).toContain("frc2056");
    expect(queue.map((item) => item.teamKey)).not.toContain("frc254");
  });

  it("attaches scouting deep links with org and team", () => {
    const linked = withScoutFormHrefs(
      [
        {
          teamKey: "frc118",
          teamNumber: 118,
          matchKey: "2026test_qm1",
          matchLabel: "QM 1",
          priority: 90,
          reasons: ["Upcoming opponent"],
          hasMatchScout: false,
          hasPitScout: false,
        },
      ],
      "org-1",
    );
    expect(linked[0]?.formHref).toContain("orgId=org-1");
    expect(linked[0]?.formHref).toContain("teamKey=frc118");
    expect(linked[0]?.formHref).toContain("matchKey=2026test_qm1");
  });
});
