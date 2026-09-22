import { describe, expect, it } from "vitest";
import {
  buildTeamMatchLog,
  fieldLabel,
  keyNumericFields,
  sharedFieldTeams,
  summarizeTeamMatches,
  type TeamLogMatchRow,
} from "./team-match-log";

const E = "2026casj";
const TEAM = "frc6925";

function tbaMatch(n: number, red: string[], blue: string[], scores?: [number, number]): TeamLogMatchRow {
  return {
    matchKey: `${E}_qm${n}`,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: n,
    redAlliance: { teamKeys: red, score: scores ? scores[0] : -1 },
    blueAlliance: { teamKeys: blue, score: scores ? scores[1] : -1 },
    winningAlliance: null,
    time: null,
  };
}

const matches = [
  tbaMatch(1, [TEAM, "frc254", "frc1"], ["frc2", "frc3", "frc4"], [80, 60]),
  tbaMatch(2, ["frc5", "frc6", "frc7"], [TEAM, "frc254", "frc8"], [70, 70]),
  tbaMatch(3, ["frc254", "frc9", "frc10"], [TEAM, "frc11", "frc12"], [90, 50]),
  tbaMatch(10, [TEAM, "frc13", "frc14"], ["frc15", "frc16", "frc17"]),
  // Not ours — must not appear.
  tbaMatch(4, ["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], [1, 2]),
];

const entry = (n: number, payload: Record<string, unknown>) => ({ matchKey: `${E}_qm${n}`, payload });

describe("keyNumericFields", () => {
  it("keeps numbers recorded in at least half the entries, minus identity and total", () => {
    const fields = keyNumericFields([
      entry(1, { totalPoints: 50, autoPoints: 10, teleopCycles: 8, fouls: 0, scoutName: "x", rare: 1 }),
      entry(2, { totalPoints: 60, autoPoints: 12, teleopCycles: 9, fouls: 1 }),
      entry(3, { totalPoints: 40, autoPoints: 8, teleopCycles: 7, fouls: 0 }),
    ]);
    expect(fields.map((field) => field.key)).toEqual(["autoPoints", "fouls", "teleopCycles"]);
    expect(fieldLabel("teleopCycles")).toBe("Teleop cycles");
    expect(fieldLabel("auto_points")).toBe("Auto points");
  });
});

describe("buildTeamMatchLog", () => {
  const log = buildTeamMatchLog({
    teamKey: TEAM,
    entries: [
      entry(1, { totalPoints: 50, autoPoints: 10, notes: "fast intake" }),
      entry(1, { totalPoints: 60, autoPoints: 14, notes: "" }),
      entry(2, { totalPoints: 30, autoPoints: 4, notes: "tipped" }),
      entry(3, { totalPoints: 70, autoPoints: 12 }),
      // A match our scouts typed in that TBA does not list.
      entry(99, { totalPoints: 20, autoPoints: 2 }),
    ],
    matches,
    formulas: [],
    notes: [{ matchKey: `${E}_qm2`, note: "defended by 254 partner" }],
    videos: [{ matchKey: `${E}_qm3`, url: "https://youtu.be/x" }],
  });

  it("lists every scheduled match of the robot plus scouted extras, in schedule order", () => {
    expect(log.rows.map((row) => row.label)).toEqual(["Q1", "Q2", "Q3", "Q10", "Q99"]);
  });

  it("splits partners and opponents from the robot's side", () => {
    const q2 = log.rows[1]!;
    expect(q2.alliance).toBe("blue");
    expect(q2.partners).toEqual(["frc254", "frc8"]);
    expect(q2.opponents).toEqual(["frc5", "frc6", "frc7"]);
    expect(log.rows[4]).toMatchObject({ alliance: null, partners: [], opponents: [], official: null });
  });

  it("keeps official results official and observed numbers observed", () => {
    expect(log.rows[0]!.official).toEqual({ result: "W", us: 80, them: 60 });
    expect(log.rows[1]!.official).toEqual({ result: "T", us: 70, them: 70 });
    expect(log.rows[2]!.official).toEqual({ result: "L", us: 50, them: 90 });
    // TBA -1 means not played: no result, not a loss.
    expect(log.rows[3]!.official).toBeNull();
    expect(log.rows[0]!.observed).toEqual({ entries: 2, total: 55, fields: { autoPoints: 12 } });
    expect(log.rows[3]!.observed).toEqual({ entries: 0, total: null, fields: { autoPoints: null } });
    expect(log.totalBasis).toEqual({ ok: true, basis: "total" });
  });

  it("collects scout notes and match-timeline notes, and the video link", () => {
    expect(log.rows[0]!.notes).toEqual(["fast intake"]);
    expect(log.rows[1]!.notes).toEqual(["tipped", "defended by 254 partner"]);
    expect(log.rows[2]!.video).toEqual({ url: "https://youtu.be/x", source: "team" });
  });

  it("says why there is no total instead of inventing one", () => {
    const noBasis = buildTeamMatchLog({
      teamKey: TEAM,
      entries: [entry(1, { cycles: 4 })],
      matches,
      formulas: [],
    });
    expect(noBasis.totalBasis.ok).toBe(false);
    expect(noBasis.rows[0]!.observed.total).toBeNull();
    expect(noBasis.rows[0]!.observed.fields).toEqual({ cycles: 4 });
  });
});

describe("summarizeTeamMatches", () => {
  const log = buildTeamMatchLog({
    teamKey: TEAM,
    entries: [
      entry(1, { totalPoints: 50 }),
      entry(2, { totalPoints: 30 }),
      entry(3, { totalPoints: 70 }),
      entry(10, { totalPoints: 90 }),
    ],
    matches,
    formulas: [],
  });

  it("gives average, best, worst and the latest three", () => {
    const summary = summarizeTeamMatches(log.rows);
    expect(summary).toMatchObject({ matches: 4, average: 60, best: 90, worst: 30 });
    expect(summary.lastThree).toBeCloseTo((30 + 70 + 90) / 3);
  });

  it("splits by a chosen team and refuses to average fewer than two matches", () => {
    const with254 = summarizeTeamMatches(log.rows, { relativeTo: "frc254" }).relative!;
    expect(with254.with).toEqual({ matches: 2, value: 40 });
    expect(with254.against).toEqual({ matches: 1, value: null });
  });

  it("returns nulls with only one scouted match", () => {
    const one = summarizeTeamMatches(log.rows.slice(0, 1));
    expect(one).toMatchObject({ matches: 1, average: null, best: null, worst: null, lastThree: null, relative: null });
  });

  it("offers the teams this robot shared a field with, most-shared first", () => {
    expect(sharedFieldTeams(log.rows)[0]).toEqual({ teamKey: "frc254", matches: 3 });
  });
});
