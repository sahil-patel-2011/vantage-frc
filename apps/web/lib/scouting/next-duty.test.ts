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
    expect(duty).toMatchObject({ matchKey: "2026casj_qm9", teamNumber: "148", matchLabel: "Q9", station: "Red 2" });
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
