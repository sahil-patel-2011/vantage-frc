import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { loadEventScoring, readEventScoring } from "../opr/alliance-results";
import { PLAYED_MATCH_RATING_CAVEAT, computeRankingProjectionView } from "./compute-ranking-projection";

vi.mock("../opr/alliance-results", () => ({
  loadEventScoring: vi.fn(),
  readEventScoring: vi.fn(),
}));

const loadEventScoringMock = vi.mocked(loadEventScoring);
const readEventScoringMock = vi.mocked(readEventScoring);

function client(bySql: (sql: string) => { rows: unknown[] }): PoolClient {
  return { query: async (sql: string) => bySql(sql) } as unknown as PoolClient;
}

function rows(epa: Record<string, number | null>) {
  return (sql: string) => {
    if (sql.includes("FROM memberships")) {
      return { rows: [{ orgId: "org-1", teamNumber: 254, eventKey: "2026gagr", eventName: "GRITS", eventYear: 2026 }] };
    }
    if (sql.includes("GROUP BY team_key")) {
      return {
        rows: ["frc254", "frc2", "frc3", "frc4", "frc5", "frc6"].map((teamKey, index) => ({
          teamKey,
          rank: index + 1,
          wins: 1,
          losses: 0,
          ties: 0,
          epaTotal: epa[teamKey] ?? null,
        })),
      };
    }
    if (sql.includes("score_breakdown")) return { rows: [] };
    if (sql.includes("match_number") && sql.includes("winning_alliance IS NULL")) {
      return {
        rows: [
          {
            matchKey: "2026gagr_qm2",
            matchNumber: 2,
            redAlliance: { teamKeys: ["frc254", "frc2", "frc3"] },
            blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] },
          },
        ],
      };
    }
    if (sql.includes("winning_alliance IS NULL")) return { rows: [{ count: "1" }] };
    if (sql.includes("winning_alliance IS NOT NULL")) return { rows: [{ count: "1" }] };
    if (sql.includes("team_event_metrics")) {
      return { rows: [{ rank: 1, wins: 1, losses: 0, ties: 0, epaTotal: epa.frc254 ?? null }] };
    }
    return { rows: [] };
  };
}

describe("ranking projection when played-match ratings throw", () => {
  beforeEach(() => {
    loadEventScoringMock.mockReset();
    loadEventScoringMock.mockRejectedValue(new Error("matches_ref missing"));
    readEventScoringMock.mockReset();
    readEventScoringMock.mockRejectedValue(new Error("matches_ref missing"));
  });

  it("keeps season ratings when every robot has one", async () => {
    const view = await computeRankingProjectionView(
      client(rows({ frc254: 90, frc2: 90, frc3: 90, frc4: 10, frc5: 10, frc6: 10 })),
      { userId: "u1", requestedOrg: "org-1" },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.whatIf).not.toBeNull();
    expect(view.whatIf?.ratingSource).toBe("season");
    expect(view.whatIf?.remaining[0].predicted).toBe("red");
    expect(view.whatIf?.caveats).not.toContain(PLAYED_MATCH_RATING_CAVEAT);
  });

  it("leaves matches unpredicted when there is no season rating either", async () => {
    const view = await computeRankingProjectionView(client(rows({})), {
      userId: "u1",
      requestedOrg: "org-1",
    });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.whatIf).not.toBeNull();
    expect(view.whatIf?.ratingSource).toBe("none");
    expect(view.whatIf?.remaining[0].predicted).toBeNull();
    expect(view.whatIfMessage).toBeNull();
  });
});
