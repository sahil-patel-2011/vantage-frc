import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { compareCandidates, computeCandidateStats, rankCandidates } from ".";
import { computeSchemaAbView } from "./compute-scouting-schema-ab";
import type { SchemaAbCandidate, SchemaAbSample } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

/** Returns queued rows in call order — mirrors the sequential query order inside
 * computeSchemaAbView (resolveOrg, candidates, samples). */
function queueClient(responses: Array<{ rows: unknown[] }>): PoolClient {
  let index = 0;
  return {
    query: vi.fn().mockImplementation(async () => {
      const response = responses[index] ?? { rows: [] };
      index += 1;
      return response;
    }),
  } as unknown as PoolClient;
}

describe("computeSchemaAbView", () => {
  it("returns setup_required when the caller has no org membership", async () => {
    const client = queueClient([{ rows: [] }]);
    const view = await computeSchemaAbView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with an empty roster when the org has no candidates yet", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG }] }, // resolveOrg
      { rows: [] }, // candidates
      { rows: [] }, // samples
    ]);
    const view = await computeSchemaAbView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.candidates).toEqual([]);
      expect(view.stats).toEqual([]);
      expect(view.comparison).toBeNull();
    }
  });

  it("ranks and compares two candidates from real logged samples", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG }] }, // resolveOrg
      {
        rows: [
          { id: "cand-a", label: "Schema A", fieldCount: 10, notes: null, createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "cand-b", label: "Schema B", fieldCount: 12, notes: null, createdAt: "2026-01-02T00:00:00.000Z" },
        ],
      }, // candidates
      {
        rows: [
          {
            id: "s1",
            candidateId: "cand-a",
            matchNumber: 1,
            fieldsTotal: 10,
            fieldsCompleted: 10,
            fillSeconds: 20,
            hadError: false,
            notes: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "s2",
            candidateId: "cand-b",
            matchNumber: 1,
            fieldsTotal: 12,
            fieldsCompleted: 6,
            fillSeconds: 60,
            hadError: true,
            notes: null,
            createdAt: "2026-01-02T00:00:00.000Z",
          },
        ],
      }, // samples
    ]);
    const view = await computeSchemaAbView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.stats).toHaveLength(2);
    expect(view.stats[0].candidateId).toBe("cand-a");
    expect(view.comparison).not.toBeNull();
    expect(view.comparison?.winnerId).toBe("cand-a");
  });
});

describe("scouting-schema-ab pure helpers", () => {
  const candidateA: SchemaAbCandidate = {
    id: "a",
    label: "Schema A",
    fieldCount: 10,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const candidateB: SchemaAbCandidate = {
    id: "b",
    label: "Schema B",
    fieldCount: 10,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("returns zeroed stats for a candidate with no samples (never fabricated)", () => {
    const stats = computeCandidateStats(candidateA, []);
    expect(stats.sampleCount).toBe(0);
    expect(stats.avgCompletionRate).toBe(0);
    expect(stats.avgFillSeconds).toBeNull();
    expect(stats.qualityScore).toBe(0);
  });

  it("computes completion/error/quality from real samples", () => {
    const samples: SchemaAbSample[] = [
      {
        id: "1",
        candidateId: "a",
        matchNumber: 1,
        fieldsTotal: 10,
        fieldsCompleted: 10,
        fillSeconds: 20,
        hadError: false,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        candidateId: "a",
        matchNumber: 2,
        fieldsTotal: 10,
        fieldsCompleted: 8,
        fillSeconds: 30,
        hadError: true,
        notes: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const stats = computeCandidateStats(candidateA, samples);
    expect(stats.sampleCount).toBe(2);
    expect(stats.avgCompletionRate).toBeCloseTo(0.9);
    expect(stats.errorRate).toBeCloseTo(0.5);
    expect(stats.avgFillSeconds).toBeCloseTo(25);
    expect(stats.qualityScore).toBeGreaterThan(0);
  });

  it("compares two candidates and picks the higher quality score", () => {
    const statsA = computeCandidateStats(candidateA, [
      {
        id: "1",
        candidateId: "a",
        matchNumber: 1,
        fieldsTotal: 10,
        fieldsCompleted: 10,
        fillSeconds: 15,
        hadError: false,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const statsB = computeCandidateStats(candidateB, [
      {
        id: "2",
        candidateId: "b",
        matchNumber: 1,
        fieldsTotal: 10,
        fieldsCompleted: 4,
        fillSeconds: 90,
        hadError: true,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const comparison = compareCandidates(statsA, statsB);
    expect(comparison.winnerId).toBe("a");
    expect(comparison.reasons.length).toBeGreaterThan(0);
  });

  it("reports no winner when a candidate has no samples yet", () => {
    const statsA = computeCandidateStats(candidateA, []);
    const statsB = computeCandidateStats(candidateB, []);
    const comparison = compareCandidates(statsA, statsB);
    expect(comparison.winnerId).toBeNull();
  });

  it("ranks candidates by quality score descending", () => {
    const low = computeCandidateStats(candidateA, [
      {
        id: "1",
        candidateId: "a",
        matchNumber: 1,
        fieldsTotal: 10,
        fieldsCompleted: 2,
        fillSeconds: 90,
        hadError: true,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const high = computeCandidateStats(candidateB, [
      {
        id: "2",
        candidateId: "b",
        matchNumber: 1,
        fieldsTotal: 10,
        fieldsCompleted: 10,
        fillSeconds: 10,
        hadError: false,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const ranked = rankCandidates([low, high]);
    expect(ranked[0].candidateId).toBe("b");
  });
});
