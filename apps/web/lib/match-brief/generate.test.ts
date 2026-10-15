import { describe, expect, it, vi } from "vitest";

const compute = vi.fn();
vi.mock("../strategy/compute-strategy", () => ({ computeStrategyView: (...args: unknown[]) => compute(...args) }));

import { eventKeyOfMatch, getOrWriteMatchBrief } from "./generate";
import { MATCH_BRIEF_KIND } from "./types";

function client(rows: { brief?: unknown; lastPlayed?: string | null; scouted?: number }) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM match_copilot_briefs")) return { rows: rows.brief ? [{ brief: rows.brief }] : [] };
      if (sql.includes("FROM matches_ref")) return { rows: rows.lastPlayed ? [{ matchKey: rows.lastPlayed }] : [] };
      if (sql.includes("FROM match_scout_entries")) return { rows: [{ count: rows.scouted ?? 0 }] };
      return { rows: [] };
    }),
  };
}

const stored = {
  kind: MATCH_BRIEF_KIND,
  matchKey: "2026casj_qm50",
  alliance: "blue",
  headline: "Slow 254 down.",
  winChance: 38,
  raiseOdds: [{ action: "Defend 254", why: "Most of red's points.", gain: 6 }],
  opponents: [],
  partners: [],
  phases: { auto: "", teleop: "", endgame: "" },
  watchFor: [],
  source: { lastPlayedMatch: "2026casj_qm48", scoutReports: 90, generatedAt: new Date(0).toISOString(), generatedBy: "u1", generatedByName: null, trigger: "auto", model: "m", writer: "ai" },
};

describe("getOrWriteMatchBrief", () => {
  it("reads the stored plan and its freshness without running the strategy computation", async () => {
    compute.mockClear();
    const db = client({ brief: stored, lastPlayed: "2026casj_qm49", scouted: 92 });
    const result = await getOrWriteMatchBrief(db as never, { userId: "u1", userName: null, orgId: "org-1", matchKey: "2026casj_qm50", mode: "read" });
    expect(result).toMatchObject({ status: "ready", stale: true, generated: false });
    expect(compute).not.toHaveBeenCalled();
  });

  it("doesn't compute on the automatic path when the plan is still current", async () => {
    compute.mockClear();
    const db = client({ brief: stored, lastPlayed: "2026casj_qm48", scouted: 91 });
    const result = await getOrWriteMatchBrief(db as never, { userId: "u1", userName: null, orgId: "org-1", matchKey: "2026casj_qm50", mode: "ensure" });
    expect(result).toMatchObject({ status: "ready", stale: false });
    expect(compute).not.toHaveBeenCalled();
  });

  it("names the event of a match key", () => {
    expect(eventKeyOfMatch("2026casj_qm50")).toBe("2026casj");
    expect(eventKeyOfMatch("2026casj_sf2m1")).toBe("2026casj");
    expect(eventKeyOfMatch("not a key")).toBeNull();
  });
});
