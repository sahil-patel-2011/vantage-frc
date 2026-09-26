import { describe, expect, it, vi } from "vitest";
import { loadScoutedMatchCounts, matchesScoutedLabel, observableMatchSql } from "./scouted-counts";

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
