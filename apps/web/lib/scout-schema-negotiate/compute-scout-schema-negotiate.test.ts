import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { diffSchemaFields, summarizeScoutSchemaNegotiate } from ".";
import { computeScoutSchemaNegotiateView } from "./compute-scout-schema-negotiate";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("diffSchemaFields (pure)", () => {
  it("finds missing and extra fields between active schema and a submission", () => {
    const { missing, extra } = diffSchemaFields(
      ["auto_score", "teleop_score", "climb"],
      ["auto_score", "teleop_score", "notes"],
    );
    expect(missing).toEqual(["climb"]);
    expect(extra).toEqual(["notes"]);
  });

  it("returns empty diffs when field sets match exactly", () => {
    const { missing, extra } = diffSchemaFields(["a", "b"], ["a", "b"]);
    expect(missing).toHaveLength(0);
    expect(extra).toHaveLength(0);
  });
});

describe("summarizeScoutSchemaNegotiate (pure)", () => {
  it("computes counts and drift rate from mixed submissions", () => {
    const versions = [
      { id: "v1", versionTag: "v2", fieldKeys: ["a", "b"], isActive: true, notes: null, createdAt: "" },
      { id: "v0", versionTag: "v1", fieldKeys: ["a"], isActive: false, notes: null, createdAt: "" },
    ];
    const submissions = [
      {
        id: "s1",
        deviceId: "tablet-1",
        schemaVersion: "v1",
        matchNumber: 1,
        teamNumber: 254,
        rawPayload: { a: 1 },
        status: "pending" as const,
        missingFields: ["b"],
        extraFields: [],
        notes: null,
        submittedAt: "",
        reconciledAt: null,
      },
      {
        id: "s2",
        deviceId: "tablet-2",
        schemaVersion: "v2",
        matchNumber: 2,
        teamNumber: 900,
        rawPayload: { a: 1, b: 2 },
        status: "reconciled" as const,
        missingFields: [],
        extraFields: [],
        notes: null,
        submittedAt: "",
        reconciledAt: "",
      },
    ];
    const summary = summarizeScoutSchemaNegotiate(submissions, versions);
    expect(summary.totalSubmissions).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.reconciled).toBe(1);
    expect(summary.activeVersionTag).toBe("v2");
    expect(summary.fieldDriftRate).toBeCloseTo(1);
    expect(summary.staleDeviceCount).toBe(1);
  });

  it("handles no pending submissions without dividing by zero", () => {
    const summary = summarizeScoutSchemaNegotiate([], []);
    expect(summary.fieldDriftRate).toBe(0);
    expect(summary.totalSubmissions).toBe(0);
  });
});

describe("computeScoutSchemaNegotiateView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeScoutSchemaNegotiateView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with versions, submissions, and summary over mock rows", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM scout_schema_negotiate_versions")) {
        return {
          rows: [
            {
              id: "ver-1",
              versionTag: "v2",
              fieldKeys: ["auto_score", "teleop_score", "climb"],
              isActive: true,
              notes: null,
              createdAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM scout_schema_negotiate_submissions")) {
        return {
          rows: [
            {
              id: "sub-1",
              deviceId: "tablet-3",
              schemaVersion: "v1",
              matchNumber: 5,
              teamNumber: 1114,
              rawPayload: { auto_score: 10, teleop_score: 20 },
              status: "pending",
              missingFields: ["climb"],
              extraFields: [],
              notes: null,
              submittedAt: new Date().toISOString(),
              reconciledAt: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeScoutSchemaNegotiateView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.versions).toHaveLength(1);
      expect(view.submissions).toHaveLength(1);
      expect(view.submissions[0].missingFields).toEqual(["climb"]);
      expect(view.summary.pending).toBe(1);
      expect(view.summary.activeVersionTag).toBe("v2");
    }
  });
});
