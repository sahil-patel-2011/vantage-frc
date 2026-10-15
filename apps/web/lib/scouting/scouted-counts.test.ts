import { describe, expect, it, vi } from "vitest";
import {
  loadScoutedMatchCounts,
  loadScoutingTotals,
  matchesScoutedLabel,
  observableMatchSql,
  pickListCountsLabel,
  robotsAndMatchesLabel,
  scoutingTotalsLabel,
  wrongRobotNote,
} from "./scouted-counts";

describe("matches scouted", () => {
  it("counts distinct matches with parameters and the watched-match rule", async () => {
    const query = vi.fn(async () => ({ rows: [{ teamKey: "frc6925", matches: 8 }] }));
    const counts = await loadScoutedMatchCounts({ query } as never, { orgId: "org", eventKey: "2026gacmp" });
    expect(counts.get("frc6925")).toBe(8);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("count(DISTINCT e.match_key)");
    expect(sql).toContain("winning_alliance IS NOT NULL");
    expect(params).toEqual(["org", "2026gacmp"]);
  });

  it("uses the alias it is given", () => {
    expect(observableMatchSql("mr")).toContain("mr.actual_time");
  });

  it("labels counts in words", () => {
    expect(matchesScoutedLabel(1)).toBe("1 match scouted");
    expect(matchesScoutedLabel(12)).toBe("12 matches scouted");
    expect(matchesScoutedLabel(0)).toBeNull();
  });
});

describe("loadScoutingTotals", () => {
  it("counts robots, robot-matches and reports with the watched-match rule and nothing else", async () => {
    const query = vi.fn(async () => ({ rows: [{ robots: 9, robotMatches: "12", reports: 14 }] }));
    const totals = await loadScoutingTotals({ query } as never, { orgId: "org", eventKey: "2025gagai" });
    expect(totals).toEqual({ robots: 9, robotMatches: 12, reports: 14 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(["org", "2025gagai"]);
    expect(sql).toContain("count(DISTINCT e.team_key)");
    expect(sql).toContain("count(DISTINCT e.team_key || '|' || e.match_key)");
    expect(sql).toContain("count(*)");
    expect(sql).toContain("JOIN matches_ref m ON m.match_key = e.match_key");
    expect(sql).toContain("m.winning_alliance IS NOT NULL");
    // No form or rating requirement: a report counts whether or not those rows exist.
    expect(sql).not.toContain("scout_schemas");
    expect(sql).not.toContain("team_event_metrics");
    expect(sql).toContain("$1::uuid");
    expect(sql).toContain("$2::text");
  });

  it("reads an empty result as zero, not NaN", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await loadScoutingTotals({ query } as never, { orgId: "org", eventKey: "2025gagai" })).toEqual({
      robots: 0,
      robotMatches: 0,
      reports: 0,
    });
  });
});

describe("shared scouting labels", () => {
  it("Teams and Ask AI: robots and matches scouted", () => {
    expect(scoutingTotalsLabel({ robots: 9, robotMatches: 12, reports: 14 })).toBe("9 robots · 12 matches scouted");
    expect(robotsAndMatchesLabel(1, 1)).toBe("1 robot · 1 match scouted");
    expect(robotsAndMatchesLabel(0, 0)).toBe("0 robots · 0 matches scouted");
  });

  it("Pick list: the pool, then the same robots count, naming robots without a rating", () => {
    expect(pickListCountsLabel({ teams: 32, scouted: 9 })).toBe("32 teams · 9 scouted");
    expect(pickListCountsLabel({ teams: 32, scouted: 9, scoutedNotRated: 2 })).toBe("32 teams · 9 scouted (2 not rated yet)");
    expect(pickListCountsLabel({ teams: 1, scouted: 0 })).toBe("1 team");
  });

  it("wrong-robot reports become a data-quality note", () => {
    expect(wrongRobotNote(0)).toBeNull();
    expect(wrongRobotNote(undefined)).toBeNull();
    expect(wrongRobotNote(1)).toMatch(/^1 robot-match was reported for a team that was not in that match/);
    expect(wrongRobotNote(2)).toMatch(/^2 robot-matches were reported/);
  });
});
