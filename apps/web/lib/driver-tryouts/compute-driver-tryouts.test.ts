import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeDriverTryoutsReadiness, summarizeDriverTryouts } from ".";
import { addEvaluation, computeDriverTryoutsView } from "./compute-driver-tryouts";
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

function candidate(
  overrides: Partial<DriverTryoutsCandidate> = {},
): DriverTryoutsCandidate {
  return {
    id: CANDIDATE_1,
    name: "Alex Rivera",
    gradeLevel: "11",
    roleInterest: "driver",
    status: "active",
    notes: null,
    seasonYear: 2026,
    ...overrides,
  };
}

function evaluation(
  overrides: Partial<DriverTryoutsEvaluation> = {},
): DriverTryoutsEvaluation {
  return {
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
    ...overrides,
  };
}

describe("driver-tryouts pure helpers", () => {
  it("leaves unscored candidates unranked with null averages — never a fabricated 0", () => {
    const summary = summarizeDriverTryouts([candidate()], []);
    expect(summary.totalCandidates).toBe(1);
    expect(summary.evaluatedCandidates).toBe(0);
    expect(summary.totalEvaluations).toBe(0);
    expect(summary.candidateScores[0]!.rank).toBeNull();
    expect(summary.candidateScores[0]!.overallAverage).toBeNull();
    expect(summary.candidateScores[0]!.averages).toBeNull();
    expect(summary.candidateScores[0]!.evaluationCount).toBe(0);

    const readiness = computeDriverTryoutsReadiness(summary);
    expect(readiness.tier).toBe("not_started");
    expect(readiness.score).toBe(0);
  });

  it("ignores evaluations that are not logged 1–5 scores when averaging", () => {
    const summary = summarizeDriverTryouts(
      [candidate()],
      [evaluation({ scorePrecision: 0, scoreAwareness: 9, scoreCommunication: 3 })],
    );
    expect(summary.totalEvaluations).toBe(0);
    expect(summary.evaluatedCandidates).toBe(0);
    expect(summary.candidateScores[0]!.overallAverage).toBeNull();
    expect(summary.candidateScores[0]!.averages).toBeNull();
  });

  it("ranks scored candidates by overall average of logged scores only", () => {
    const candidates: DriverTryoutsCandidate[] = [
      candidate({ id: CANDIDATE_1, name: "Alex" }),
      candidate({ id: CANDIDATE_2, name: "Bailey" }),
    ];
    const evaluations: DriverTryoutsEvaluation[] = [
      evaluation({
        id: "e1",
        candidateId: CANDIDATE_1,
        scorePrecision: 5,
        scoreAwareness: 5,
        scoreCommunication: 5,
        scoreComposure: 5,
        scoreMechanical: 5,
      }),
      evaluation({
        id: "e2",
        candidateId: CANDIDATE_2,
        scorePrecision: 2,
        scoreAwareness: 2,
        scoreCommunication: 2,
        scoreComposure: 2,
        scoreMechanical: 2,
      }),
    ];
    const summary = summarizeDriverTryouts(candidates, evaluations);
    expect(summary.evaluatedCandidates).toBe(2);
    expect(summary.candidateScores[0]!.candidateId).toBe(CANDIDATE_1);
    expect(summary.candidateScores[0]!.rank).toBe(1);
    expect(summary.candidateScores[0]!.overallAverage).toBe(5);
    expect(summary.candidateScores[0]!.averages).toEqual({
      precision: 5,
      awareness: 5,
      communication: 5,
      composure: 5,
      mechanical: 5,
    });
    expect(summary.candidateScores[1]!.candidateId).toBe(CANDIDATE_2);
    expect(summary.candidateScores[1]!.rank).toBe(2);
    expect(summary.candidateScores[1]!.overallAverage).toBe(2);
  });

  it("averages two logged evaluations without filling missing criteria", () => {
    const summary = summarizeDriverTryouts(
      [candidate()],
      [
        evaluation({
          id: "e1",
          scorePrecision: 5,
          scoreAwareness: 4,
          scoreCommunication: 3,
          scoreComposure: 5,
          scoreMechanical: 4,
        }),
        evaluation({
          id: "e2",
          scorePrecision: 3,
          scoreAwareness: 2,
          scoreCommunication: 3,
          scoreComposure: 3,
          scoreMechanical: 2,
        }),
      ],
    );
    expect(summary.candidateScores[0]!.evaluationCount).toBe(2);
    expect(summary.candidateScores[0]!.averages).toEqual({
      precision: 4,
      awareness: 3,
      communication: 3,
      composure: 4,
      mechanical: 3,
    });
    expect(summary.candidateScores[0]!.overallAverage).toBe(3.4);
  });
});

describe("addEvaluation", () => {
  it("refuses to store scores that were not logged as integers 1–5", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    await expect(
      addEvaluation(client, {
        orgId: ORG,
        userId: USER,
        candidateId: CANDIDATE_1,
        evaluatedOn: "2026-02-01",
        scorePrecision: 0,
        scoreAwareness: 4,
        scoreCommunication: 4,
        scoreComposure: 4,
        scoreMechanical: 4,
        notes: null,
      }),
    ).rejects.toThrow(/1 to 5/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("inserts the logged rubric when every score is a real 1–5", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 1 }));
    await addEvaluation(client, {
      orgId: ORG,
      userId: USER,
      candidateId: CANDIDATE_1,
      evaluatedOn: "2026-02-01",
      scorePrecision: 5,
      scoreAwareness: 4,
      scoreCommunication: 3,
      scoreComposure: 2,
      scoreMechanical: 1,
      notes: "clear cycle",
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    const [, params] = vi.mocked(client.query).mock.calls[0]!;
    expect(params).toEqual([
      ORG,
      CANDIDATE_1,
      USER,
      "2026-02-01",
      5,
      4,
      3,
      2,
      1,
      "clear cycle",
    ]);
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
      expect(view.summary.candidateScores[0]!.overallAverage).toBe(4);
      expect(view.readiness.tier).not.toBe("not_started");
    }
  });

  it("drops rows whose stored scores are not logged 1–5 values", async () => {
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
              id: "e-bad",
              candidateId: CANDIDATE_1,
              evaluatorId: USER,
              evaluatedOn: "2026-02-01",
              scorePrecision: 0,
              scoreAwareness: null,
              scoreCommunication: 3,
              scoreComposure: 4,
              scoreMechanical: 5,
              notes: null,
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
      expect(view.evaluations).toHaveLength(0);
      expect(view.summary.candidateScores[0]!.overallAverage).toBeNull();
      expect(view.summary.candidateScores[0]!.averages).toBeNull();
      expect(view.readiness.tier).toBe("not_started");
    }
  });
});
