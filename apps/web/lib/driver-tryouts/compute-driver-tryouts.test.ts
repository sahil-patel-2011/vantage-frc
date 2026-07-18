import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeDriverTryoutsReadiness, summarizeDriverTryouts } from ".";
import { computeDriverTryoutsView } from "./compute-driver-tryouts";
import type { DriverTryoutsCandidate, DriverTryoutsEvaluation } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_1 = "33333333-3333-4333-8333-333333333333";
const CANDIDATE_2 = "44444444-4444-4444-8444-444444444444";

function mockClient(
  handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number },
): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("driver-tryouts pure helpers", () => {
  it("summarizes candidates with no evaluations as unranked, all-zero averages", () => {
    const candidates: DriverTryoutsCandidate[] = [
      {
        id: CANDIDATE_1,
        name: "Alex Rivera",
        gradeLevel: "11",
        roleInterest: "driver",
        status: "active",
        notes: null,
        seasonYear: 2026,
      },
    ];
    const summary = summarizeDriverTryouts(candidates, []);
    expect(summary.totalCandidates).toBe(1);
    expect(summary.evaluatedCandidates).toBe(0);
    expect(summary.candidateScores[0]!.rank).toBeNull();
    expect(summary.candidateScores[0]!.overallAverage).toBe(0);

    const readiness = computeDriverTryoutsReadiness(summary);
    expect(readiness.tier).toBe("not_started");
    expect(readiness.score).toBe(0);
  });

  it("ranks scored candidates by overall average descending", () => {
    const candidates: DriverTryoutsCandidate[] = [
      { id: CANDIDATE_1, name: "Alex", gradeLevel: null, roleInterest: "driver", status: "active", notes: null, seasonYear: 2026 },
      { id: CANDIDATE_2, name: "Bailey", gradeLevel: null, roleInterest: "driver", status: "active", notes: null, seasonYear: 2026 },
    ];
    const evaluations: DriverTryoutsEvaluation[] = [
      {
        id: "e1",
        candidateId: CANDIDATE_1,
        evaluatorId: USER,
        evaluatedOn: "2026-02-01",
        scorePrecision: 5,
        scoreAwareness: 5,
        scoreCommunication: 5,
        scoreComposure: 5,
        scoreMechanical: 5,
        notes: null,
      },
      {
        id: "e2",
        candidateId: CANDIDATE_2,
        evaluatorId: USER,
        evaluatedOn: "2026-02-01",
        scorePrecision: 2,
        scoreAwareness: 2,
        scoreCommunication: 2,
        scoreComposure: 2,
        scoreMechanical: 2,
        notes: null,
      },
    ];
    const summary = summarizeDriverTryouts(candidates, evaluations);
    expect(summary.evaluatedCandidates).toBe(2);
    expect(summary.candidateScores[0]!.candidateId).toBe(CANDIDATE_1);
    expect(summary.candidateScores[0]!.rank).toBe(1);
    expect(summary.candidateScores[0]!.overallAverage).toBe(5);
    expect(summary.candidateScores[1]!.candidateId).toBe(CANDIDATE_2);
    expect(summary.candidateScores[1]!.rank).toBe(2);
  });
});

describe("computeDriverTryoutsView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeDriverTryoutsView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view summarizing candidates and evaluations for the org", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 100 }], rowCount: 1 };
      }
      if (sql.includes("FROM driver_tryouts_candidates") && sql.includes("SELECT id, name")) {
        return {
          rows: [
            {
              id: CANDIDATE_1,
              name: "Alex Rivera",
              gradeLevel: "11",
              roleInterest: "driver",
              status: "active",
              notes: null,
              seasonYear: 2026,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }], rowCount: 1 };
      }
      if (sql.includes("FROM driver_tryouts_evaluations")) {
        return {
          rows: [
            {
              id: "e1",
              candidateId: CANDIDATE_1,
              evaluatorId: USER,
              evaluatedOn: "2026-02-01",
              scorePrecision: 4,
              scoreAwareness: 4,
              scoreCommunication: 3,
              scoreComposure: 4,
              scoreMechanical: 5,
              notes: "Strong under pressure",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeDriverTryoutsView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.candidates).toHaveLength(1);
      expect(view.evaluations).toHaveLength(1);
      expect(view.summary.evaluatedCandidates).toBe(1);
      expect(view.summary.candidateScores[0]!.rank).toBe(1);
      expect(view.readiness.tier).not.toBe("not_started");
    }
  });
});
