import { describe, expect, it } from "vitest";
import {
  describeScoutContext,
  nextScoutTarget,
  robotStation,
  scoutContext,
  syncSummary,
} from "./scout-context";

const q = (n: number, red: string[], blue: string[]) => ({
  matchKey: `2026gaalb_qm${n}`,
  matchNumber: n,
  compLevel: "qm",
  redAlliance: { teamKeys: red },
  blueAlliance: { teamKeys: blue },
});

const schedule = [
  q(11, ["frc111", "frc254", "frc333"], ["frc444", "frc555", "frc666"]),
  q(10, ["frc1", "frc1323", "frc3"], ["frc4", "frc5", "frc6"]),
];

describe("scoutContext", () => {
  it("names the team, match and station from the schedule", () => {
    const context = scoutContext({ matches: schedule, matchKey: "2026gaalb_qm10", teamKey: "frc1323" });
    expect(context).toEqual({ teamNumber: "1323", matchLabel: "Qual 10", stationLabel: "Red 2" });
    expect(describeScoutContext(context!)).toBe("1323 · Qual 10 · Red 2");
  });

  it("leaves the station out for a robot the schedule does not place", () => {
    const context = scoutContext({ matches: [], matchKey: "2026gaalb_qm7", teamKey: "frc9999" });
    expect(describeScoutContext(context!)).toBe("9999 · Qual 7");
  });

  it("is null until a robot is picked", () => {
    expect(scoutContext({ matches: schedule, matchKey: "2026gaalb_qm10", teamKey: "" })).toBeNull();
  });

  it("finds blue stations too", () => {
    expect(robotStation(schedule[0], "frc666")).toEqual({ alliance: "blue", station: 3 });
  });
});

describe("nextScoutTarget", () => {
  it("prefers the scout's next assignment", () => {
    const next = nextScoutTarget({
      matches: schedule,
      assignments: [{ matchKey: "2026gaalb_qm11", teamKey: "frc555" }],
      savedMatchKey: "2026gaalb_qm10",
      savedTeamKey: "frc1323",
    });
    expect(next).toMatchObject({ matchKey: "2026gaalb_qm11", teamKey: "frc555", stationLabel: "Blue 2", reason: "assignment" });
  });

  it("skips a robot this scout already has, instead of opening its report to overwrite", () => {
    const next = nextScoutTarget({
      matches: schedule,
      assignments: [],
      savedMatchKey: "2026gaalb_qm10",
      savedTeamKey: "frc1323",
      done: (matchKey, teamKey) => matchKey === "2026gaalb_qm11" && teamKey === "frc254",
    });
    // Red 2 (254) is done: the first robot on the same alliance this scout has not done is 111.
    expect(next).toMatchObject({ matchKey: "2026gaalb_qm11", teamKey: "frc111", stationLabel: "Red 1" });
  });

  it("keeps the same station in the next scheduled match", () => {
    const next = nextScoutTarget({
      matches: schedule,
      assignments: [],
      savedMatchKey: "2026gaalb_qm10",
      savedTeamKey: "frc1323",
    });
    expect(next).toMatchObject({ matchKey: "2026gaalb_qm11", teamKey: "frc254", matchLabel: "Qual 11", stationLabel: "Red 2" });
  });

  it("names the next match without a robot when its alliances are not out", () => {
    const next = nextScoutTarget({
      matches: [schedule[1]!, { matchKey: "2026gaalb_qm11", matchNumber: 11, compLevel: "qm" }],
      assignments: [],
      savedMatchKey: "2026gaalb_qm10",
      savedTeamKey: "frc1323",
    });
    expect(next).toMatchObject({ matchKey: "2026gaalb_qm11", teamKey: "", reason: "match" });
  });

  it("says nothing for a match typed by hand or the last match", () => {
    expect(
      nextScoutTarget({ matches: schedule, assignments: [], savedMatchKey: "2026gaalb_qm40", savedTeamKey: "frc1" }),
    ).toBeNull();
    expect(
      nextScoutTarget({ matches: schedule, assignments: [], savedMatchKey: "2026gaalb_qm11", savedTeamKey: "frc254" }),
    ).toBeNull();
  });
});

describe("syncSummary", () => {
  it("uses the singular and skips what did not move", () => {
    expect(syncSummary({ entries: 1, media: 0 })).toBe("Uploaded 1 entry");
    expect(syncSummary({ entries: 3, media: 2 })).toBe("Uploaded 3 entries and 2 photos and videos");
    expect(syncSummary({ entries: 0, media: 0 })).toBeNull();
  });
});
