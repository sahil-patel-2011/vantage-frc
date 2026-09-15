import { describe, expect, it } from "vitest";
import {
  buildIntelTeamMatch,
  matchResultForAlliance,
  sortEventStandings,
} from "@vantage/intel-research";
import {
  intelAllianceLabel,
  intelCompLevelLabel,
  intelCurrentStanding,
  intelLastPlayedMatch,
  intelMatchLabel,
  intelMatchResultLabel,
  intelPartnerLine,
  intelRankLine,
  intelRecordLine,
  intelScoreLine,
} from "./intel-board";

describe("intel team board labels", () => {
  it("uses full match names, not Qual/QF", () => {
    expect(intelCompLevelLabel("qm")).toBe("Qualification");
    expect(intelMatchLabel({ compLevel: "qm", matchNumber: 12, setNumber: 1 })).toBe("Qualification 12");
    expect(intelMatchLabel({ compLevel: "qf", matchNumber: 1, setNumber: 2 })).toBe("Quarterfinal 2-1");
    expect(intelMatchResultLabel("win")).toBe("Win");
    expect(intelMatchResultLabel("unplayed")).toBe("Not played");
    expect(intelAllianceLabel("red")).toBe("Red");
  });

  it("prints rank and record only from real numbers", () => {
    expect(intelRankLine(4)).toBe("Rank 4");
    expect(intelRankLine(null)).toBeNull();
    expect(intelRecordLine(12, 4, 1)).toBe("12–4–1");
    expect(intelRecordLine(8, 2, 0)).toBe("8–2");
    expect(intelRecordLine(null, null, null)).toBeNull();
    expect(intelPartnerLine([1678, 118])).toBe("1678 · 118");
    expect(intelPartnerLine([])).toBeNull();
  });

  it("picks the active event standing, then the latest", () => {
    const events = [
      { eventKey: "2026txho", eventName: "Houston", year: 2026, rank: 6, wins: 8, losses: 3, ties: 0, rating: 40 },
      { eventKey: "2025cmptx", eventName: "Worlds", year: 2025, rank: 2, wins: 10, losses: 2, ties: 0, rating: 55 },
    ];
    expect(intelCurrentStanding(events, "2025cmptx")?.eventKey).toBe("2025cmptx");
    expect(intelCurrentStanding(events, null)?.eventKey).toBe("2026txho");
  });
});

describe("intel match rows from official alliances", () => {
  const red = { teamKeys: ["frc254", "frc1678", "frc118"], score: 112 };
  const blue = { teamKeys: ["frc1323", "frc4414", "frc973"], score: 98 };

  it("builds a win with partners and scores", () => {
    const match = buildIntelTeamMatch({
      teamKey: "frc254",
      matchKey: "2026txho_qm12",
      eventKey: "2026txho",
      eventName: "Houston",
      year: 2026,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: 12,
      redAlliance: red,
      blueAlliance: blue,
      winningAlliance: "red",
      playedAt: "2026-04-01T18:00:00.000Z",
    });
    expect(match?.alliance).toBe("red");
    expect(match?.partners).toEqual([1678, 118]);
    expect(match?.opponents).toEqual([1323, 4414, 973]);
    expect(match?.ourScore).toBe(112);
    expect(match?.theirScore).toBe(98);
    expect(match?.result).toBe("win");
    expect(intelScoreLine(match!)).toBe("112–98");
    expect(intelLastPlayedMatch([match!])?.matchKey).toBe("2026txho_qm12");
  });

  it("stays unplayed when there is no winner or score", () => {
    expect(matchResultForAlliance("blue", null, null, null)).toBe("unplayed");
    expect(
      buildIntelTeamMatch({
        teamKey: "frc9999",
        matchKey: "2026txho_qm1",
        eventKey: "2026txho",
        eventName: null,
        year: 2026,
        compLevel: "qm",
        setNumber: 1,
        matchNumber: 1,
        redAlliance: red,
        blueAlliance: blue,
        winningAlliance: "red",
        playedAt: null,
      }),
    ).toBeNull();
  });

  it("sorts event standings newest year first", () => {
    expect(
      sortEventStandings([
        { eventKey: "2025casj", eventName: "San Jose", year: 2025, rank: 3, wins: 9, losses: 3, ties: 0, rating: 30 },
        { eventKey: "2026txho", eventName: "Houston", year: 2026, rank: 1, wins: 11, losses: 1, ties: 0, rating: 50 },
      ]).map((row) => row.eventKey),
    ).toEqual(["2026txho", "2025casj"]);
  });
});
