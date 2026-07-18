import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeSubsystemSignoffReadiness, summarizeSubsystemSignoff } from ".";
import { computeSubsystemSignoffView } from "./compute-subsystem-signoff";
import type { SignoffRecord, Subsystem } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SUB_1 = "33333333-3333-4333-8333-333333333333";
const SUB_2 = "44444444-4444-4444-8444-444444444444";

function mockClient(
  handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number },
): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

function subsystem(overrides: Partial<Subsystem> = {}): Subsystem {
  return {
    id: SUB_1,
    name: "Drivetrain",
    category: "drivetrain",
    status: "in_progress",
    notes: null,
    seasonYear: 2026,
    ...overrides,
  };
}

let seq = 0;
function record(overrides: Partial<SignoffRecord> = {}): SignoffRecord {
  seq += 1;
  return {
    id: `rec-${seq}`,
    subsystemId: SUB_1,
    gate: "design",
    decision: "approved",
    reviewerId: USER,
    signedOn: "2026-02-15",
    notes: null,
    ...overrides,
  };
}

describe("subsystem-signoff pure helpers", () => {
  it("reports zero readiness for an empty board and prompts adding subsystems", () => {
    const summary = summarizeSubsystemSignoff([], []);
    expect(summary.totalSubsystems).toBe(0);
    const readiness = computeSubsystemSignoffReadiness(summary);
    expect(readiness.score).toBe(0);
    expect(readiness.tier).toBe("not_started");
    expect(readiness.recommendations[0]).toMatch(/add the robot subsystems/i);
  });

  it("shows unsigned subsystems with zero completion and no rank inflation", () => {
    const summary = summarizeSubsystemSignoff([subsystem()], []);
    expect(summary.startedSubsystems).toBe(0);
    expect(summary.signedOffSubsystems).toBe(0);
    expect(summary.subsystemScores[0]!.completion).toBe(0);
    expect(summary.subsystemScores[0]!.approvedGates).toBe(0);
    const readiness = computeSubsystemSignoffReadiness(summary);
    expect(readiness.tier).toBe("not_started");
  });

  it("uses the latest decision per gate so a later rejection reopens a gate", () => {
    // Records arrive newest-first (as the query orders them): the rejection is newer.
    const records = [
      record({ gate: "design", decision: "rejected", signedOn: "2026-03-01" }),
      record({ gate: "design", decision: "approved", signedOn: "2026-02-01" }),
    ];
    const summary = summarizeSubsystemSignoff([subsystem()], records);
    const score = summary.subsystemScores[0]!;
    expect(score.approvedGates).toBe(0);
    expect(score.rejectedGates).toBe(1);
    expect(score.gates.find((g) => g.gate === "design")!.decision).toBe("rejected");
  });

  it("marks a subsystem fully approved only when every gate is approved", () => {
    const gates = ["design", "fabrication", "assembly", "wiring", "programming", "field_test"] as const;
    const records = gates.map((gate) => record({ gate }));
    const summary = summarizeSubsystemSignoff([subsystem()], records);
    const score = summary.subsystemScores[0]!;
    expect(score.fullyApproved).toBe(true);
    expect(score.completion).toBe(1);
    expect(summary.signedOffSubsystems).toBe(1);
    const readiness = computeSubsystemSignoffReadiness(summary);
    expect(readiness.tier).toBe("ready");
    expect(readiness.subsystemsFullyApproved).toBe(1);
  });

  it("flags blocked subsystems in its recommendations", () => {
    const summary = summarizeSubsystemSignoff(
      [subsystem({ id: SUB_2, status: "blocked" })],
      [record({ subsystemId: SUB_2, gate: "design" })],
    );
    expect(summary.blockedSubsystems).toBe(1);
    const readiness = computeSubsystemSignoffReadiness(summary);
    expect(readiness.recommendations.some((line) => /blocked/i.test(line))).toBe(true);
  });
});

describe("computeSubsystemSignoffView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeSubsystemSignoffView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view summarizing subsystems and their gate decisions", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 100 }], rowCount: 1 };
      }
      if (sql.includes("FROM subsystem_signoff_subsystems") && sql.includes("SELECT id, name")) {
        return {
          rows: [
            {
              id: SUB_1,
              name: "Drivetrain",
              category: "drivetrain",
              status: "in_progress",
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
      if (sql.includes("FROM subsystem_signoff_records")) {
        return {
          rows: [
            {
              id: "rec-1",
              subsystemId: SUB_1,
              gate: "design",
              decision: "approved",
              reviewerId: USER,
              signedOn: "2026-02-15",
              notes: "Looks solid",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeSubsystemSignoffView(client, {
      userId: USER,
      requestedOrg: ORG,
      seasonYear: 2026,
    });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.subsystems).toHaveLength(1);
      expect(view.records).toHaveLength(1);
      expect(view.summary.startedSubsystems).toBe(1);
      expect(view.summary.approvedGates).toBe(1);
      expect(view.summary.subsystemScores[0]!.approvedGates).toBe(1);
      expect(view.readiness.tier).not.toBe("not_started");
    }
  });
});
