import { describe, expect, it } from "vitest";
import type { ScheduleMatch } from "../schedule-board";
import {
  attachTimelineDetail,
  expectedStart,
  groupTimeline,
  isPlayed,
  matchPassesFilter,
  missedCount,
  nextMyAssignment,
  safeVideoUrl,
  shortMatchLabel,
  tbaVideoUrl,
} from "./match-timeline";
import { allianceScore, mapTbaScheduleMatches } from "./tba-cache";

const T0 = Date.parse("2026-03-14T17:00:00Z");
const min = (n: number) => new Date(T0 + n * 60_000).toISOString();

function match(n: number, partial: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    matchKey: `2026casj_qm${n}`,
    compLevel: "qm",
    matchNumber: n,
    scheduledTime: null,
    red: ["frc1", "frc2", "frc3"],
    blue: ["frc4", "frc5", "frc6"],
    redScore: null,
    blueScore: null,
    winningAlliance: null,
    scoutCount: 0,
    ...partial,
  };
}

const played = (n: number, extra: Partial<ScheduleMatch> = {}) =>
  match(n, { redScore: 50, blueScore: 40, winningAlliance: "red", ...extra });

describe("shortMatchLabel", () => {
  it("writes the label a scout says out loud", () => {
    expect(shortMatchLabel("qm", 1, 12)).toBe("Q12");
    expect(shortMatchLabel("sf", 2, 1)).toBe("SF2-1");
    expect(shortMatchLabel("qf", 3, 2)).toBe("QF3-2");
    expect(shortMatchLabel("f", 1, 2)).toBe("F2");
    expect(shortMatchLabel("sf", null, 4)).toBe("SF4");
  });
});

describe("groupTimeline", () => {
  it("puts the unplayed match that started within ~8 minutes on the field", () => {
    const matches = [played(1), match(2, { predictedTime: min(-5) }), match(3, { predictedTime: min(3) }), match(4), match(5), match(6)];
    const groups = groupTimeline(matches, T0);
    expect(groups.played.map((m) => m.matchNumber)).toEqual([1]);
    expect(groups.now?.matchNumber).toBe(2);
    expect(groups.upNext.map((m) => m.matchNumber)).toEqual([3, 4, 5]);
    expect(groups.later.map((m) => m.matchNumber)).toEqual([6]);
  });

  it("falls back to the next unplayed match when no time is inside the window", () => {
    const matches = [played(1), match(2, { plannedTime: min(-30) }), match(3, { plannedTime: min(20) })];
    const groups = groupTimeline(matches, T0);
    expect(groups.now?.matchNumber).toBe(2);
    expect(groups.upNext.map((m) => m.matchNumber)).toEqual([3]);
  });

  it("keeps an older unplayed match in Up next instead of inventing a result for it", () => {
    const matches = [match(1, { plannedTime: min(-40) }), match(2, { predictedTime: min(-2) }), match(3)];
    const groups = groupTimeline(matches, T0);
    expect(groups.now?.matchNumber).toBe(2);
    expect(groups.played).toEqual([]);
    expect(groups.upNext.map((m) => m.matchNumber)).toEqual([1, 3]);
  });

  it("treats a match with an actual time but no posted score as played", () => {
    const pending = match(1, { actualTime: min(-3) });
    expect(isPlayed(pending)).toBe(true);
    expect(groupTimeline([pending, match(2)], T0).now?.matchNumber).toBe(2);
  });

  it("has no now when every match is played", () => {
    const groups = groupTimeline([played(1), played(2)], T0);
    expect(groups.now).toBeNull();
    expect(groups.upNext).toEqual([]);
  });

  it("prefers TBA's live estimate over the published slot", () => {
    expect(expectedStart(match(1, { plannedTime: min(0), predictedTime: min(9) }))).toBe(min(9));
    expect(expectedStart(match(1, { scheduledTime: min(4) }))).toBe(min(4));
  });
});

describe("attachTimelineDetail", () => {
  const base = [played(1), match(2)];

  it("joins assignees, entries, notes and videos per robot without inventing any", () => {
    const [q1, q2] = attachTimelineDetail(base, {
      assignments: [
        { matchKey: "2026casj_qm1", teamKey: "frc1", userId: "ada", name: "Ada", role: "Red 1" },
        { matchKey: "2026casj_qm1", teamKey: "frc4", userId: "bo", name: "Bo", role: "primary" },
        { matchKey: "2026casj_qm2", teamKey: "frc5", userId: "cy", name: null, role: "primary" },
      ],
      entries: [
        { matchKey: "2026casj_qm1", teamKey: "frc1", scoutUserId: "ada", count: 1 },
        { matchKey: "2026casj_qm1", teamKey: "frc2", scoutUserId: "zed", count: "2" },
      ],
      notes: [{ matchKey: "2026casj_qm1", count: 3 }],
      videos: [{ matchKey: "2026casj_qm1", url: "https://youtu.be/abc" }, { matchKey: "2026casj_qm2", url: "javascript:alert(1)" }],
    });
    expect(q1!.scoutCount).toBe(3);
    expect(q1!.noteCount).toBe(3);
    expect(q1!.video).toEqual({ url: "https://youtu.be/abc", source: "team" });
    const red1 = q1!.robots!.find((robot) => robot.teamKey === "frc1")!;
    expect(red1).toMatchObject({ alliance: "red", station: 1, entryCount: 1 });
    expect(red1.assignees[0]).toMatchObject({ name: "Ada", role: "primary", submitted: true, missed: false });
    const blue1 = q1!.robots!.find((robot) => robot.teamKey === "frc4")!;
    expect(blue1.assignees[0]).toMatchObject({ submitted: false, missed: true });
    expect(q1!.robots!.find((robot) => robot.teamKey === "frc3")!.assignees).toEqual([]);
    expect(missedCount(q1!)).toBe(1);
    // Unplayed: nobody is "missed" before results post; unnamed members get a neutral label.
    expect(q2!.robots!.find((robot) => robot.teamKey === "frc5")!.assignees[0]).toMatchObject({ name: "Team member", missed: false });
    expect(q2!.video).toBeNull();
  });

  it("only counts a backup as missed when the primary missed too", () => {
    const covered = attachTimelineDetail([played(1)], {
      assignments: [
        { matchKey: "2026casj_qm1", teamKey: "frc2", userId: "p", name: "Primary", role: "primary" },
        { matchKey: "2026casj_qm1", teamKey: "frc2", userId: "b", name: "Backup", role: "backup" },
      ],
      entries: [{ matchKey: "2026casj_qm1", teamKey: "frc2", scoutUserId: "p", count: 1 }],
    })[0]!;
    const robot = covered.robots!.find((r) => r.teamKey === "frc2")!;
    expect(robot.assignees.map((a) => [a.name, a.missed])).toEqual([
      ["Primary", false],
      ["Backup", false],
    ]);

    const bothMissed = attachTimelineDetail([played(1)], {
      assignments: [
        { matchKey: "2026casj_qm1", teamKey: "frc2", userId: "p", name: "Primary", role: "primary" },
        { matchKey: "2026casj_qm1", teamKey: "frc2", userId: "b", name: "Backup", role: "backup" },
      ],
    })[0]!;
    expect(missedCount(bothMissed)).toBe(2);
  });

  it("keeps TBA's official video when the team indexed none", () => {
    const withTba = attachTimelineDetail([match(1, { video: { url: "https://www.youtube.com/watch?v=abcdefghijk", source: "tba" } })], {});
    expect(withTba[0]!.video?.source).toBe("tba");
  });
});

describe("filters and my assignments", () => {
  const detailed = attachTimelineDetail([played(1), match(2), match(3, { red: ["frc9", "frc2", "frc3"] })], {
    assignments: [
      { matchKey: "2026casj_qm2", teamKey: "frc6", userId: "me", name: "Me", role: "backup" },
      { matchKey: "2026casj_qm3", teamKey: "frc9", userId: "me", name: "Me", role: "primary" },
      { matchKey: "2026casj_qm1", teamKey: "frc1", userId: "me", name: "Me", role: "primary" },
    ],
  });

  it("filters to our matches and to mine", () => {
    const who = { teamKey: "frc1", userId: "me" };
    expect(detailed.filter((m) => matchPassesFilter(m, "ours", who)).map((m) => m.matchNumber)).toEqual([1, 2]);
    expect(detailed.filter((m) => matchPassesFilter(m, "mine", who)).map((m) => m.matchNumber)).toEqual([1, 2, 3]);
    expect(matchPassesFilter(detailed[0]!, "mine", { teamKey: null, userId: null })).toBe(false);
    expect(matchPassesFilter(detailed[0]!, "all", { teamKey: null, userId: null })).toBe(true);
  });

  it("points at the next unplayed primary duty before a backup", () => {
    const next = nextMyAssignment(detailed, "me");
    expect(next?.match.matchNumber).toBe(3);
    expect(next?.robot).toMatchObject({ teamKey: "frc9", alliance: "red", station: 1 });
    expect(nextMyAssignment(detailed.slice(0, 2), "me")?.role).toBe("backup");
    expect(nextMyAssignment(detailed, null)).toBeNull();
  });
});

describe("video links and scores", () => {
  it("renders only http(s) links", () => {
    expect(safeVideoUrl(" https://drive.google.com/x ")).toBe("https://drive.google.com/x");
    expect(safeVideoUrl("javascript:alert(1)")).toBeNull();
    expect(safeVideoUrl("not a url")).toBeNull();
  });

  it("builds a YouTube URL from TBA's videos array and nothing else", () => {
    expect(tbaVideoUrl("youtube", "abcdefghijk")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(tbaVideoUrl("youtube", "abcdefghijk?t=30")).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=30");
    expect(tbaVideoUrl("tba", "x")).toBeNull();
    expect(tbaVideoUrl("youtube", "<script>")).toBeNull();
  });

  it("reads TBA's -1 as no score, so a future match is never 'played'", () => {
    expect(allianceScore({ score: -1 })).toBeNull();
    expect(allianceScore({ score: 0 })).toBe(0);
    const [future] = mapTbaScheduleMatches([
      {
        matchKey: "2026casj_qm9",
        compLevel: "qm",
        matchNumber: 9,
        scheduledTime: null,
        redAlliance: { teamKeys: ["frc1"], score: -1 },
        blueAlliance: { teamKeys: ["frc2"], score: -1 },
        winningAlliance: "",
        setNumber: 1,
        plannedTime: "2026-03-14 17:00:00+00",
        predictedTime: null,
        actualTime: null,
        postResultTime: null,
        tbaVideoType: null,
        tbaVideoKey: null,
      },
    ]);
    expect(isPlayed(future!)).toBe(false);
    expect(future!.plannedTime).toBe("2026-03-14T17:00:00.000Z");
    expect(future!.video).toBeNull();
  });
});
