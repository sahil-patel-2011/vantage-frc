import { describe, expect, it } from "vitest";
import { nextScoutingDuty } from "./next-duty";

const NOW = new Date("2026-03-14T15:00:00Z");

describe("nextScoutingDuty", () => {
  it("picks the earliest primary duty in field order, with its station", () => {
    const duty = nextScoutingDuty({
      assignments: [
        { matchKey: "2026casj_qm20", teamKey: "frc254" },
        { matchKey: "2026casj_qm9", teamKey: "frc148" },
      ],
      matches: [{ matchKey: "2026casj_qm9", redAlliance: ["frc1", "frc148", "frc3"], blueAlliance: ["frc4", "frc5", "frc6"] }],
      now: NOW,
    });
    expect(duty).toMatchObject({ matchKey: "2026casj_qm9", teamNumber: "148", matchLabel: "Qual 9", station: "Red 2" });
  });

  it("reads the jsonb alliance shape matches_ref stores", () => {
    const duty = nextScoutingDuty({
      assignments: [{ matchKey: "2026casj_qm9", teamKey: "frc6" }],
      matches: [{ matchKey: "2026casj_qm9", redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] }, blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] } }],
      now: NOW,
    });
    expect(duty?.station).toBe("Blue 3");
  });

  it("skips backups, robots already filed, and matches well in the past", () => {
    const duty = nextScoutingDuty({
      assignments: [
        { matchKey: "2026casj_qm1", teamKey: "frc1", role: "backup" },
        { matchKey: "2026casj_qm2", teamKey: "frc2" },
        { matchKey: "2026casj_qm3", teamKey: "frc3", startsAt: "2026-03-14T14:00:00Z" },
        { matchKey: "2026casj_qm4", teamKey: "frc4", startsAt: "2026-03-14T14:50:00Z" },
      ],
      entries: [{ type: "match", matchKey: "2026casj_qm2", teamKey: "frc2" }],
      now: NOW,
    });
    // qm4 started ten minutes ago: still inside the grace window, so it is kept.
    expect(duty?.matchKey).toBe("2026casj_qm4");
  });

  it("skips a match that already ran, even with no entry and no planned start", () => {
    const duty = nextScoutingDuty({
      assignments: [
        { matchKey: "2026casj_qm7", teamKey: "frc7" },
        { matchKey: "2026casj_qm8", teamKey: "frc8" },
      ],
      matches: [
        { matchKey: "2026casj_qm7", matchTime: "2026-03-14T13:00:00Z" },
        { matchKey: "2026casj_qm8", matchTime: "2026-03-14T15:20:00Z" },
      ],
      now: NOW,
    });
    expect(duty?.matchKey).toBe("2026casj_qm8");
  });

  it("does not count a pit entry as covering a match duty", () => {
    const duty = nextScoutingDuty({
      assignments: [{ matchKey: "2026casj_qm5", teamKey: "frc5" }],
      entries: [{ type: "pit", matchKey: null, teamKey: "frc5" }],
      now: NOW,
    });
    expect(duty?.matchKey).toBe("2026casj_qm5");
    expect(duty?.station).toBeNull();
  });

  it("returns null when there is nothing left to do", () => {
    expect(nextScoutingDuty({ assignments: [], now: NOW })).toBeNull();
    expect(
      nextScoutingDuty({
        assignments: [{ matchKey: "2026casj_qm1", teamKey: "frc1" }],
        entries: [{ matchKey: "2026casj_qm1", teamKey: "frc1" }],
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("nextScoutingDuty on a live event", () => {
  it("shows the match's own time, not the time written on the assignment", () => {
    const duty = nextScoutingDuty({
      assignments: [{ matchKey: "2026gacmp_qm33", teamKey: "frc1678", startsAt: "2026-09-26T01:48:00Z" }],
      matches: [
        {
          matchKey: "2026gacmp_qm33",
          compLevel: "qm",
          matchNumber: 33,
          matchTime: "2026-09-26T14:37:00Z",
          actualTime: null,
          winningAlliance: null,
          redAlliance: { teamKeys: ["frc1678", "frc2", "frc3"] },
        },
      ],
      now: new Date("2026-09-26T13:34:00Z"),
    });
    expect(duty).toMatchObject({ matchLabel: "Qual 33", startsAt: "2026-09-26T14:37:00Z", station: "Red 1" });
  });

  it("keeps an unplayed duty while the event runs late", () => {
    const duty = nextScoutingDuty({
      assignments: [{ matchKey: "2026gacmp_qm31", teamKey: "frc118" }],
      matches: [
        { matchKey: "2026gacmp_qm30", compLevel: "qm", matchNumber: 30, matchTime: "2026-09-26T14:40:00Z", actualTime: "2026-09-26T14:40:00Z", winningAlliance: "red" },
        { matchKey: "2026gacmp_qm31", compLevel: "qm", matchNumber: 31, matchTime: "2026-09-26T15:07:00Z", actualTime: null, winningAlliance: null },
      ],
      now: new Date("2026-09-26T15:40:00Z"),
    });
    expect(duty?.matchKey).toBe("2026gacmp_qm31");
  });
});
