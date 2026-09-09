import { describe, expect, it } from "vitest";
import { buildTeamDossier, seasonsCompeted } from "./team-dossier";
import type { TbaResponse } from "./tba-client";
import type { TbaGetter } from "./worker";

function tbaFrom(routes: Record<string, unknown>, calls: string[] = []): TbaGetter {
  return {
    async get<T>(resource: string): Promise<TbaResponse<T>> {
      calls.push(resource);
      if (!(resource in routes)) throw new Error(`404 ${resource}`);
      return { status: 200, data: routes[resource] as T, etag: null, lastModified: null };
    },
  };
}

function sbFrom(routes: Record<string, unknown>) {
  return {
    async get<T>(resource: string): Promise<T> {
      if (!(resource in routes)) throw new Error(`404 ${resource}`);
      return routes[resource] as T;
    },
  };
}

const TBA_OK = {
  "/team/frc6925": {
    nickname: "Rocket City Robots",
    name: "Long sponsor string",
    city: "Huntsville",
    state_prov: "Alabama",
    country: "USA",
    rookie_year: 2018,
    website: "https://example.org",
    school_name: "Example High",
  },
  "/team/frc6925/years_participated": [2018, 2019, 2022, 2023],
  "/team/frc6925/awards": [
    { name: "Rookie All Star", event_key: "2018alhu", year: 2018 },
    { name: "Imagery Award", event_key: "2023alhu", year: 2023 },
  ],
  "/team/frc6925/events/2022/simple": [{ key: "2022alhu", name: "Rocket City Regional", week: 2, year: 2022 }],
  "/team/frc6925/events/2022/statuses": {
    "2022alhu": {
      qual: { num_teams: 40, ranking: { rank: 12, record: { wins: 6, losses: 4, ties: 0 } } },
      overall_status_str: "Team 6925 was eliminated in the quarterfinals",
    },
  },
  "/team/frc6925/events/2023/simple": [{ key: "2023alhu", name: "Rocket City Regional", week: 3, year: 2023 }],
  "/team/frc6925/events/2023/statuses": { "2023alhu": null },
};

const SB_OK = {
  "/team/6925": { norm_epa: { current: 1512 }, record: { wins: 40, losses: 38, ties: 1, winrate: 0.51 } },
  "/team_years?team=6925&limit=50": [
    { year: 2023, epa: { total_points: { mean: 41.2 }, ranks: { total: { rank: 1500, team_count: 3300 }, state: { rank: 12 } } } },
    { year: 2022, epa: { total_points: { mean: 30.1 }, ranks: { total: { rank: 2100, team_count: 3200 } } } },
  ],
};

describe("buildTeamDossier", () => {
  it("assembles profile, longevity, awards, recent events, and stats from real answers", async () => {
    const calls: string[] = [];
    const dossier = await buildTeamDossier({ teamNumber: 6925, tba: tbaFrom(TBA_OK, calls), statbotics: sbFrom(SB_OK) });

    expect(dossier.profile).toEqual({
      nickname: "Rocket City Robots",
      name: "Long sponsor string",
      city: "Huntsville",
      stateProv: "Alabama",
      country: "USA",
      rookieYear: 2018,
      website: "https://example.org",
      schoolName: "Example High",
    });
    expect(dossier.yearsParticipated).toEqual([2018, 2019, 2022, 2023]);
    expect(seasonsCompeted(dossier.yearsParticipated)).toBe(4);

    // Newest first, with the event name resolved when that event was fetched.
    expect(dossier.awards.map((a) => [a.year, a.name, a.eventName])).toEqual([
      [2023, "Imagery Award", "Rocket City Regional"],
      [2018, "Rookie All Star", null],
    ]);

    // Recent seasons are the last two ATTENDED (2022, 2023), not 2022/2021.
    expect(calls.filter((c) => c.includes("/events/")).map((c) => c.match(/events\/(\d{4})/)![1])).toEqual([
      "2022", "2022", "2023", "2023",
    ]);
    expect(dossier.events).toEqual([
      { year: 2023, eventKey: "2023alhu", name: "Rocket City Regional", week: 4, rank: null, teams: null, wins: null, losses: null, ties: null, playoff: null },
      { year: 2022, eventKey: "2022alhu", name: "Rocket City Regional", week: 3, rank: 12, teams: 40, wins: 6, losses: 4, ties: 0, playoff: "Team 6925 was eliminated in the quarterfinals" },
    ]);

    expect(dossier.stats?.normEpa).toBe(1512);
    expect(dossier.stats?.record).toEqual({ wins: 40, losses: 38, ties: 1, winrate: 0.51 });
    expect(dossier.stats?.years[0]).toEqual({
      year: 2023, epa: 41.2, rankWorld: 1500, teamsWorld: 3300, rankCountry: null, rankState: 12, rankDistrict: null,
    });
    expect(dossier.sources.tba.ok).toBe(true);
    expect(dossier.sources.statbotics.ok).toBe(true);
  });

  it("keeps TBA facts when Statbotics is down, and says which source failed", async () => {
    const dossier = await buildTeamDossier({ teamNumber: 6925, tba: tbaFrom(TBA_OK), statbotics: sbFrom({}) });
    expect(dossier.profile?.city).toBe("Huntsville");
    expect(dossier.stats).toBeNull();
    expect(dossier.sources.statbotics).toMatchObject({ ok: false, error: expect.stringContaining("404") });
    expect(dossier.sources.tba.ok).toBe(true);
  });

  it("keeps Statbotics facts when TBA is down — and never invents a profile", async () => {
    const dossier = await buildTeamDossier({ teamNumber: 6925, tba: tbaFrom({}), statbotics: sbFrom(SB_OK) });
    expect(dossier.profile).toBeNull();
    expect(dossier.yearsParticipated).toEqual([]);
    expect(dossier.awards).toEqual([]);
    expect(dossier.stats?.normEpa).toBe(1512);
    expect(dossier.sources.tba.ok).toBe(false);
  });

  it("bounds the TBA call budget: 3 fixed + 2 per recent season", async () => {
    const calls: string[] = [];
    await buildTeamDossier({ teamNumber: 6925, tba: tbaFrom(TBA_OK, calls), statbotics: sbFrom(SB_OK), recentSeasons: 1 });
    expect(calls).toHaveLength(3 + 2);
  });

  it("treats an unknown team as no data, not as an error page", async () => {
    const dossier = await buildTeamDossier({
      teamNumber: 99999,
      tba: tbaFrom({ "/team/frc99999": null, "/team/frc99999/years_participated": [], "/team/frc99999/awards": [] }),
      statbotics: sbFrom({}),
    });
    expect(dossier.profile).toBeNull();
    expect(dossier.events).toEqual([]);
    expect(dossier.sources.tba.ok).toBe(true);
  });
});
