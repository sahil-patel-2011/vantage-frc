import { describe, expect, it } from "vitest";
import {
  buildScoutTargets,
  manualMatchKey,
  normalizeTeamKey,
  type ScheduledMatch,
  type ScoutAssignment,
} from "./scout-target";

const ASSIGNMENT: ScoutAssignment = {
  matchKey: "2026gagai_qm3",
  teamKey: "frc6925",
  compLevel: "qm",
  matchNumber: 3,
};

const SCHEDULE: ScheduledMatch[] = [
  {
    matchKey: "2026gagai_qm3",
    matchNumber: 3,
    compLevel: "qm",
    redAlliance: { teamKeys: ["frc6925", "frc254", "frc1678"] },
    blueAlliance: { teamKeys: ["frc118", "frc971", "frc2056"] },
  },
  {
    matchKey: "2026gagai_qm4",
    matchNumber: 4,
    compLevel: "qm",
    redAlliance: { teamKeys: ["frc33"] },
    blueAlliance: { teamKeys: ["frc67"] },
  },
];

describe("buildScoutTargets", () => {
  it("does not hide the schedule from someone who has an assignment", () => {
    // This is the whole point. The old selector replaced the schedule with your
    // assignments, so a scout who was given one match could not record the one
    // they actually watched.
    const options = buildScoutTargets({ assignments: [ASSIGNMENT], matches: SCHEDULE });
    expect(options.length).toBe(8);
    expect(options.some((o) => o.teamKey === "frc67")).toBe(true);
  });

  it("puts your assignments first and marks them", () => {
    const options = buildScoutTargets({ assignments: [ASSIGNMENT], matches: SCHEDULE });
    expect(options[0].assigned).toBe(true);
    expect(options[0].teamKey).toBe("frc6925");
    expect(options.slice(1).every((o) => !o.assigned)).toBe(true);
  });

  it("lists a robot once, even when it is both assigned and scheduled", () => {
    const options = buildScoutTargets({ assignments: [ASSIGNMENT], matches: SCHEDULE });
    const duplicates = options.filter(
      (o) => o.matchKey === ASSIGNMENT.matchKey && o.teamKey === ASSIGNMENT.teamKey,
    );
    expect(duplicates.length).toBe(1);
  });

  it("works with a schedule and no assignments", () => {
    const options = buildScoutTargets({ matches: SCHEDULE });
    expect(options.length).toBe(8);
    expect(options.every((o) => !o.assigned)).toBe(true);
  });

  it("works with assignments and no schedule", () => {
    const options = buildScoutTargets({ assignments: [ASSIGNMENT] });
    expect(options.length).toBe(1);
    expect(options[0].assigned).toBe(true);
  });

  it("returns nothing rather than throwing when there is nothing at all", () => {
    expect(buildScoutTargets({})).toEqual([]);
  });

  it("skips alliances with no teams instead of emitting blank rows", () => {
    const options = buildScoutTargets({
      matches: [{ matchKey: "2026gagai_qm9", matchNumber: 9, redAlliance: null, blueAlliance: null }],
    });
    expect(options).toEqual([]);
  });

  it("labels a match with no comp level rather than printing undefined", () => {
    const options = buildScoutTargets({
      matches: [
        { matchKey: "x_1", matchNumber: 1, compLevel: null, redAlliance: { teamKeys: ["frc1"] } },
      ],
    });
    expect(options[0].label).toBe("MATCH 1 · 1");
  });
});

describe("normalizeTeamKey", () => {
  it("accepts what a person types on a phone", () => {
    expect(normalizeTeamKey("254")).toBe("frc254");
    expect(normalizeTeamKey(" 254 ")).toBe("frc254");
    expect(normalizeTeamKey("frc254")).toBe("frc254");
    expect(normalizeTeamKey("FRC254")).toBe("frc254");
  });

  it("keeps the B-team suffix offseason events use", () => {
    expect(normalizeTeamKey("254b")).toBe("frc254B");
    expect(normalizeTeamKey("frc1678C")).toBe("frc1678C");
  });

  it("refuses a leading-zero form rather than guessing", () => {
    // "0254" is a typo. Accepting it as 254 files scouting against a robot on
    // the strength of a guess.
    expect(normalizeTeamKey("0254")).toBeNull();
  });

  it("refuses team zero and anything that is not a number", () => {
    expect(normalizeTeamKey("0")).toBeNull();
    expect(normalizeTeamKey("")).toBeNull();
    expect(normalizeTeamKey("red")).toBeNull();
    expect(normalizeTeamKey("254-b")).toBeNull();
    expect(normalizeTeamKey("123456")).toBeNull();
  });
});

describe("manualMatchKey", () => {
  it("uses the same shape The Blue Alliance does", () => {
    expect(manualMatchKey("2026gagai", "qm", 7)).toBe("2026gagai_qm7");
  });

  it("works for an event a team added themselves", () => {
    expect(manualMatchKey("2026custom-1a2b3c4d-grits", "qm", 12)).toBe(
      "2026custom-1a2b3c4d-grits_qm12",
    );
  });

  it("refuses a match number nobody could have played", () => {
    expect(manualMatchKey("2026gagai", "qm", 0)).toBeNull();
    expect(manualMatchKey("2026gagai", "qm", 1.5)).toBeNull();
    expect(manualMatchKey("2026gagai", "qm", 1000)).toBeNull();
  });

  it("refuses an empty event", () => {
    expect(manualMatchKey("", "qm", 1)).toBeNull();
    expect(manualMatchKey("   ", "qm", 1)).toBeNull();
  });
});
