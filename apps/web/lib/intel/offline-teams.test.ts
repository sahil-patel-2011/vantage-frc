import { describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("../offline/feature-cache", () => ({
  putFeatureSnapshot: async (feature: string, orgId: string, data: unknown, variant = "") =>
    void store.set(`${feature}|${orgId}|${variant}`, data),
  getFeatureSnapshot: async (feature: string, orgId: string, variant = "") => {
    const data = store.get(`${feature}|${orgId}|${variant}`);
    return data === undefined ? null : { data, cachedAt: "2026-09-23T00:00:00Z" };
  },
}));

import { loadRoster, loadTeamResponse, prefetchEventTeams, searchRosterOffline, type OfflineRosterTeam } from "./offline-teams";

const ROSTER: OfflineRosterTeam[] = [
  { teamKey: "frc2056", teamNumber: 2056, nickname: "OP Robotics", epaTotal: 40, scouted: 3 },
  { teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", epaTotal: 60, scouted: 2 },
  { teamKey: "frc118", teamNumber: 118, nickname: "Robonauts", epaTotal: null, scouted: 0 },
];

describe("searchRosterOffline", () => {
  it("matches a number prefix, best-rated first", () => {
    expect(searchRosterOffline(ROSTER, "2").map((team) => team.teamNumber)).toEqual([254, 2056]);
    expect(searchRosterOffline(ROSTER, "frc118").map((team) => team.teamNumber)).toEqual([118]);
  });

  it("matches a word in the nickname and never invents a team", () => {
    expect(searchRosterOffline(ROSTER, "poofs").map((team) => team.teamNumber)).toEqual([254]);
    expect(searchRosterOffline(ROSTER, "9999")).toEqual([]);
  });

  it("returns the whole list for an empty query", () => {
    expect(searchRosterOffline(ROSTER, "  ")).toHaveLength(3);
  });
});

describe("prefetchEventTeams", () => {
  it("saves the list and each board it can read, and says how many", async () => {
    store.clear();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("q=")) return new Response(JSON.stringify({ roster: ROSTER }));
      if (url.includes("team=118")) return new Response("down", { status: 503 });
      const team = Number(/team=(\d+)/.exec(url)![1]);
      return new Response(JSON.stringify({ team: { team: { teamNumber: team } } }));
    });
    const progress: number[] = [];
    const result = await prefetchEventTeams("org-1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: (done) => progress.push(done),
    });
    expect(result).toEqual({ teams: 3, saved: 2 });
    expect(progress).toHaveLength(3);
    expect((await loadRoster("org-1"))?.roster).toHaveLength(3);
    expect(await loadTeamResponse("org-1", 254)).toMatchObject({ data: { team: { team: { teamNumber: 254 } } } });
    expect(await loadTeamResponse("org-1", 118)).toBeNull();
  });

  it("claims nothing when the team list cannot be read", async () => {
    store.clear();
    const result = await prefetchEventTeams("org-1", {
      fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
    });
    expect(result).toBeNull();
    expect(store.size).toBe(0);
  });

  it("stops at the limit", async () => {
    store.clear();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("q=")
        ? new Response(JSON.stringify({ roster: ROSTER }))
        : new Response(JSON.stringify({ team: { team: {} } })),
    );
    const result = await prefetchEventTeams("org-1", { limit: 1, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ teams: 3, saved: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
