import { describe, expect, it, vi } from "vitest";
import { computeScoutTrainingView } from "./compute-scout-training-mode";
import { computeAccuracy, summarizeAttempts, trainingWinnerLabel } from "./index";
import type { TrainingAttempt } from "./types";

type QueryCall = { sql: string; params: unknown[] };

function makeClient(responses: Array<{ rows: unknown[] }>) {
  const calls: QueryCall[] = [];
  let index = 0;
  return {
    calls,
    query: vi.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return Promise.resolve(response);
    }),
  };
}

describe("computeScoutTrainingView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient([{ rows: [] }]);
    const view = await computeScoutTrainingView(client as never, { userId: "u1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when no historical match data has synced yet", async () => {
    const client = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 118 }] },
      { rows: [] }, // practice matches
      { rows: [] }, // attempts
    ]);
    const view = await computeScoutTrainingView(client as never, { userId: "u1", requestedOrg: "org-1" });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe("org-1");
    }
  });

  it("returns a live view with summarized attempts when data is present", async () => {
    const client = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 118 }] },
      {
        rows: [
          {
            matchKey: "2026miket_qm1",
            eventKey: "2026miket",
            compLevel: "qm",
            matchNumber: 1,
            winningAlliance: "red",
            redScore: 120,
            blueScore: 95,
          },
        ],
      },
      {
        rows: [
          {
            id: "attempt-1",
            matchKey: "2026miket_qm1",
            eventKey: "2026miket",
            compLevel: "qm",
            matchNumber: 1,
            predictedWinner: "red",
            predictedRedScore: 115,
            predictedBlueScore: 90,
            actualWinningAlliance: "red",
            actualRedScore: 120,
            actualBlueScore: 95,
            notes: null,
            durationSeconds: 180,
            accuracyScore: 0.95,
            submittedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ]);

    const view = await computeScoutTrainingView(client as never, { userId: "u1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe("org-1");
      expect(view.practiceMatches).toHaveLength(1);
      expect(view.attempts).toHaveLength(1);
      expect(view.summary.totalAttempts).toBe(1);
      expect(view.summary.averageAccuracy).toBeCloseTo(0.95);
    }
  });
});

describe("computeAccuracy", () => {
  it("scores a fully correct prediction near 1", () => {
    const score = computeAccuracy({
      predictedWinner: "red",
      actualWinningAlliance: "red",
      predictedRedScore: 120,
      predictedBlueScore: 95,
      actualRedScore: 120,
      actualBlueScore: 95,
    });
    expect(score).toBeCloseTo(1, 1);
  });

  it("scores an incorrect winner call low even with close numbers", () => {
    const score = computeAccuracy({
      predictedWinner: "blue",
      actualWinningAlliance: "red",
      predictedRedScore: 118,
      predictedBlueScore: 96,
      actualRedScore: 120,
      actualBlueScore: 95,
    });
    expect(score).toBeLessThan(0.6);
  });

  it("falls back to winner-only scoring when actual scores are unknown", () => {
    const score = computeAccuracy({
      predictedWinner: "red",
      actualWinningAlliance: "red",
      predictedRedScore: 999,
      predictedBlueScore: 0,
      actualRedScore: null,
      actualBlueScore: null,
    });
    expect(score).toBe(1);
  });
});

describe("summarizeAttempts", () => {
  it("returns zeroed summary for an empty list", () => {
    const summary = summarizeAttempts([]);
    expect(summary.totalAttempts).toBe(0);
    expect(summary.averageAccuracy).toBe(0);
    expect(summary.recentAccuracyTrend).toEqual([]);
  });

  it("aggregates averages and winner-call accuracy", () => {
    const attempts: TrainingAttempt[] = [
      {
        id: "a",
        matchKey: "m1",
        eventKey: "e1",
        compLevel: "qm",
        matchNumber: 1,
        predictedWinner: "red",
        predictedRedScore: 100,
        predictedBlueScore: 80,
        actualWinningAlliance: "red",
        actualRedScore: 100,
        actualBlueScore: 80,
        notes: null,
        durationSeconds: 60,
        accuracyScore: 1,
        submittedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        matchKey: "m2",
        eventKey: "e1",
        compLevel: "qm",
        matchNumber: 2,
        predictedWinner: "blue",
        predictedRedScore: 80,
        predictedBlueScore: 100,
        actualWinningAlliance: "red",
        actualRedScore: 100,
        actualBlueScore: 80,
        notes: null,
        durationSeconds: 60,
        accuracyScore: 0,
        submittedAt: "2026-01-02T00:00:00.000Z",
      },
    ];

    const summary = summarizeAttempts(attempts);
    expect(summary.totalAttempts).toBe(2);
    expect(summary.averageAccuracy).toBe(0.5);
    expect(summary.winnerCallAccuracy).toBe(0.5);
    expect(summary.recentAccuracyTrend).toEqual([1, 0]);
  });
});

describe("trainingWinnerLabel", () => {
  it("labels each winner and unknown", () => {
    expect(trainingWinnerLabel("red")).toBe("Red alliance");
    expect(trainingWinnerLabel("blue")).toBe("Blue alliance");
    expect(trainingWinnerLabel("tie")).toBe("Tie");
    expect(trainingWinnerLabel(null)).toBe("Unknown");
  });
});
