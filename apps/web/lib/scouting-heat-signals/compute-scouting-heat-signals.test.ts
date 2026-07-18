import { describe, expect, it, vi } from "vitest";
import { computeScoutingHeatSignalsView } from "./compute-scouting-heat-signals";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] };

function makeClient(handler: QueryHandler) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("computeScoutingHeatSignalsView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeScoutingHeatSignalsView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns live status with no teams when no entries have been logged", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM scouting_heat_signals_entries")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeScoutingHeatSignalsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.teams).toHaveLength(0);
      expect(view.summary).toMatchObject({ totalTeams: 0, totalEntries: 0 });
    }
  });

  it("aggregates mock observation rows into rising/falling team heat signals", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM scouting_heat_signals_entries")) {
        return {
          rows: [
            {
              id: "e1",
              teamKey: "frc118",
              teamNumber: 118,
              nickname: "Robonauts",
              observedOn: "2026-02-01",
              direction: "up",
              metricValue: "20",
              note: "Fast cycles",
              matchKey: "2026week1_qm1",
              loggedBy: USER,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "e2",
              teamKey: "frc118",
              teamNumber: 118,
              nickname: "Robonauts",
              observedOn: "2026-02-08",
              direction: "up",
              metricValue: "35",
              note: "Even faster",
              matchKey: "2026week2_qm5",
              loggedBy: USER,
              createdAt: "2026-02-08T00:00:00.000Z",
            },
            {
              id: "e3",
              teamKey: "frc148",
              teamNumber: 148,
              nickname: "Robowranglers",
              observedOn: "2026-02-01",
              direction: "down",
              metricValue: "40",
              note: "Drivetrain issues",
              matchKey: "2026week1_qm2",
              loggedBy: USER,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "e4",
              teamKey: "frc148",
              teamNumber: 148,
              nickname: "Robowranglers",
              observedOn: "2026-02-08",
              direction: "down",
              metricValue: "22",
              note: "Still struggling",
              matchKey: "2026week2_qm6",
              loggedBy: USER,
              createdAt: "2026-02-08T00:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const view = await computeScoutingHeatSignalsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;

    expect(view.teams).toHaveLength(2);
    const rising = view.teams.find((team) => team.teamKey === "frc118");
    const falling = view.teams.find((team) => team.teamKey === "frc148");
    expect(rising).toMatchObject({ direction: "up", entryCount: 2, metricDelta: 15 });
    expect(falling).toMatchObject({ direction: "down", entryCount: 2, metricDelta: -18 });
    expect(view.summary).toMatchObject({ totalTeams: 2, totalEntries: 4, risingTeams: 1, fallingTeams: 1 });
  });
});
