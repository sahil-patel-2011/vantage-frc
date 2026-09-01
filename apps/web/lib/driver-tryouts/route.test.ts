import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "11111111-1111-4111-8111-111111111111" } } as { user: { id: string } } | null,
  inserts: [] as unknown[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: { query: (sql: string) => Promise<{ rowCount: number; rows: unknown[] }> }) => Promise<unknown>) =>
    work({
      query: async (sql: string) => {
        if (sql.includes("INSERT INTO driver_tryouts_evaluations")) {
          state.inserts.push(sql);
        }
        if (sql.includes("FROM memberships")) {
          return { rows: [{ ok: 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }),
}));

const { POST } = await import("../../app/api/driver-tryouts/route");

const ORG = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/driver-tryouts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
  state.inserts = [];
});

describe("POST /api/driver-tryouts add-evaluation", () => {
  it("returns 401 without a session", async () => {
    state.session = null;
    const response = await post({ orgId: ORG, action: "add-evaluation" });
    expect(response.status).toBe(401);
  });

  it("rejects missing scores instead of inventing 1s", async () => {
    const response = await post({
      orgId: ORG,
      action: "add-evaluation",
      candidateId: CANDIDATE,
      evaluatedOn: "2026-02-01",
      scorePrecision: 4,
      scoreAwareness: 4,
      // communication omitted
      scoreComposure: 4,
      scoreMechanical: 4,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "each rubric score must be an integer from 1 to 5",
    });
    expect(state.inserts).toEqual([]);
  });

  it("rejects clamped-looking out-of-range scores instead of storing 1 or 5", async () => {
    const response = await post({
      orgId: ORG,
      action: "add-evaluation",
      candidateId: CANDIDATE,
      evaluatedOn: "2026-02-01",
      scorePrecision: 0,
      scoreAwareness: 4,
      scoreCommunication: 4,
      scoreComposure: 4,
      scoreMechanical: 9,
    });
    expect(response.status).toBe(400);
    expect(state.inserts).toEqual([]);
  });
});
