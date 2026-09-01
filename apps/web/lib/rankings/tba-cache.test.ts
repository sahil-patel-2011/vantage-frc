import { describe, expect, it } from "vitest";
import {
  RANKINGS_POLL_MS,
  buildRankingsView,
  classifyRankingsCache,
  laterSync,
  latestSyncedAt,
  mapTbaPlayoffMatches,
  mapTbaRankedTeams,
  rankingsCacheRequiredCopy,
  shouldRefreshRankings,
  type TbaRankCacheRow,
} from "./tba-cache";
import type { TbaMatchCacheRow } from "../schedule/tba-cache";

const CONTEXT = {
  orgId: "org-1",
  orgName: "1678",
  teamNumber: 1678,
  role: "member",
  eventKey: "2026casj",
  eventName: "San Jose",
};

function metric(overrides: Partial<TbaRankCacheRow> = {}): TbaRankCacheRow {
  return {
    teamKey: "frc1678",
    nickname: "Citrus Circuits",
    rank: 4,
    wins: 7,
    losses: 2,
    ties: 0,
    epaTotal: 55.1,
    epaAuto: 12,
    epaTeleop: 30,
    epaEndgame: 13.1,
    source: "tba",
    syncedAt: "2026-03-14T18:00:00Z",
    ...overrides,
  };
}

function playoff(overrides: Partial<TbaMatchCacheRow> = {}): TbaMatchCacheRow {
  return {
    matchKey: "2026casj_qf1m1",
    compLevel: "qf",
    matchNumber: 1,
    scheduledTime: "2026-03-15T20:00:00Z",
    redAlliance: { teamKeys: ["frc1", "frc2", "frc3"] },
    blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
    winningAlliance: null,
    syncedAt: "2026-03-15T19:00:00Z",
    ...overrides,
  };
}

describe("rankings TBA cache refresh", () => {
  it("keeps an event-day cadence of at least 15s", () => {
    expect(RANKINGS_POLL_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("pauses while the tab is hidden", () => {
    expect(shouldRefreshRankings({ visibilityState: "hidden" })).toBe(false);
    expect(shouldRefreshRankings({ visibilityState: "visible" })).toBe(true);
    expect(shouldRefreshRankings({ visibilityState: undefined })).toBe(true);
  });

  it("does not overlap an in-flight refresh", () => {
    expect(shouldRefreshRankings({ visibilityState: "visible", inFlight: true })).toBe(false);
    expect(shouldRefreshRankings({ visibilityState: "visible", inFlight: false })).toBe(true);
    expect(shouldRefreshRankings({ visibilityState: "hidden", inFlight: true })).toBe(false);
    expect(shouldRefreshRankings({ visibilityState: "hidden", pauseWhenHidden: false })).toBe(true);
  });
});

describe("classifyRankingsCache", () => {
  it("is setup until an event is selected", () => {
    expect(classifyRankingsCache({ eventKey: null, teamCount: 0 })).toBe("setup");
    expect(classifyRankingsCache({ eventKey: "", teamCount: 24 })).toBe("setup");
  });

  it("is cache_required when the event is set but Neon has no ranking rows", () => {
    expect(classifyRankingsCache({ eventKey: "2026casj", teamCount: 0 })).toBe("cache_required");
  });

  it("is ready only after cache rows exist", () => {
    expect(classifyRankingsCache({ eventKey: "2026casj", teamCount: 2 })).toBe("ready");
  });
});

describe("mapTbaRankedTeams", () => {
  it("stays blank when the cache has no rows — never invents a field of ranks", () => {
    expect(mapTbaRankedTeams([])).toEqual([]);
  });

  it("maps exactly the cached teams and leaves rank blank until the row has one", () => {
    const teams = mapTbaRankedTeams([
      metric({ teamKey: "frc254", rank: 1 }),
      metric({ teamKey: "frc1678", rank: null, wins: null, losses: null, ties: null }),
    ]);
    expect(teams).toHaveLength(2);
    expect(teams[0]?.rank).toBe(1);
    expect(teams[1]?.rank).toBeNull();
    expect(teams[1]?.record).toBeNull();
  });

  it("does not invent rank from array index", () => {
    const teams = mapTbaRankedTeams([
      metric({ teamKey: "frc10", rank: null }),
      metric({ teamKey: "frc20", rank: null }),
    ]);
    expect(teams.map((entry) => entry.rank)).toEqual([null, null]);
    expect(teams.map((entry) => entry.teamKey)).toEqual(["frc10", "frc20"]);
  });

  it("skips rows without a team key", () => {
    expect(mapTbaRankedTeams([metric({ teamKey: null }), metric({ teamKey: "frc99", rank: 9 })]).map((entry) => entry.teamKey)).toEqual([
      "frc99",
    ]);
  });
});

describe("mapTbaPlayoffMatches", () => {
  it("stays blank when the cache has no playoff rows — never invents a bracket", () => {
    expect(mapTbaPlayoffMatches([])).toEqual([]);
  });

  it("skips quals and incomplete keys instead of inventing slots", () => {
    const matches = mapTbaPlayoffMatches([
      playoff({ matchKey: "2026casj_qm12", compLevel: "qm", matchNumber: 12 }),
      playoff({ matchKey: null, compLevel: "qf" }),
      playoff({ matchKey: "2026casj_sf1m1", compLevel: "sf", matchNumber: 1 }),
    ]);
    expect(matches.map((entry) => entry.matchKey)).toEqual(["2026casj_sf1m1"]);
  });

  it("does not pad alliances on a real cached match", () => {
    const [match] = mapTbaPlayoffMatches([
      playoff({
        redAlliance: { teamKeys: ["frc1"] },
        blueAlliance: { team_keys: ["frc4", "frc5"] },
      }),
    ]);
    expect(match?.red).toEqual(["frc1"]);
    expect(match?.blue).toEqual(["frc4", "frc5"]);
  });
});

describe("buildRankingsView", () => {
  it("is setup_required without an org or active event", () => {
    expect(
      buildRankingsView({
        context: { ...CONTEXT, orgId: null, eventKey: null },
      }).status,
    ).toBe("setup_required");
    expect(
      buildRankingsView({
        context: { ...CONTEXT, eventKey: null },
      }).status,
    ).toBe("setup_required");
  });

  it("returns a ready view with zero teams when the cache is cold", () => {
    const view = buildRankingsView({ context: CONTEXT, metricRows: [], playoffRows: [] });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.teams).toEqual([]);
    expect(view.playoffs).toEqual([]);
    expect(classifyRankingsCache({ eventKey: view.context.eventKey, teamCount: view.teams.length })).toBe(
      "cache_required",
    );
  });

  it("never invents ranks or bracket slots beyond the cache rows", () => {
    const view = buildRankingsView({
      context: CONTEXT,
      metricRows: [metric({ teamKey: "frc1678", rank: null }), metric({ teamKey: "frc254", rank: 2 })],
      playoffRows: [playoff()],
    });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.teams).toHaveLength(2);
    expect(view.teams.find((team) => team.teamKey === "frc1678")?.rank).toBeNull();
    expect(view.playoffs).toHaveLength(1);
    expect(classifyRankingsCache({ eventKey: view.context.eventKey, teamCount: view.teams.length })).toBe(
      "ready",
    );
  });
});

describe("laterSync", () => {
  it("picks the later timestamp and ignores nulls", () => {
    expect(laterSync(null, "2026-03-14T18:00:00Z")).toBe("2026-03-14T18:00:00Z");
    expect(laterSync("2026-03-14T18:00:00Z", "2026-03-14T19:00:00Z")).toBe("2026-03-14T19:00:00Z");
    expect(laterSync("2026-03-14T19:00:00Z", null)).toBe("2026-03-14T19:00:00Z");
    expect(latestSyncedAt([null, "2026-03-14T10:00:00Z", "2026-03-14T12:00:00Z"])).toBe(
      "2026-03-14T12:00:00Z",
    );
  });
});

describe("rankingsCacheRequiredCopy", () => {
  it("says ranks stay blank until cache rows — never invented", () => {
    const copy = rankingsCacheRequiredCopy();
    expect(copy.description).toMatch(/cache/i);
    expect(copy.description).toMatch(/blank/i);
    expect(`${copy.title} ${copy.description}`).not.toMatch(/\bDEMO\b/);
  });
});
