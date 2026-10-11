/**
 * PATCH /api/reimbursements/[id]: the two-person rule (A5-14), a denial needs a reason, and a
 * reopened claim keeps its denial note (A5-11).
 *
 * The database is a fake that answers by SQL shape; the matching RLS (0723) is checked against a
 * real PostgreSQL when the migration is replayed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWN_CLAIM_DECISION } from "../../../../lib/finance/reimbursements";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TREASURER = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";

type Query = { sql: string; params: unknown[] };

const state = vi.hoisted(() => ({
  userId: "",
  canManage: true,
  claim: {} as Record<string, unknown>,
  queries: [] as Query[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => (state.userId ? { user: { id: state.userId } } : null) } },
}));
vi.mock("@vantage/db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.queries.push({ sql, params });
      if (sql.includes("FROM memberships")) return { rowCount: 1, rows: [{ role: "scout" }] };
      if (sql.includes("can_manage_finances")) return { rowCount: 1, rows: [{ allowed: state.canManage }] };
      if (sql.includes("FROM reimbursement_requests r")) return { rowCount: 1, rows: [state.claim] };
      if (/^\s*UPDATE reimbursement_requests/.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  };
  return { withRls: async (_context: unknown, work: (c: typeof client) => Promise<unknown>) => work(client) };
});

const route = await import("./route");

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLAIM,
    seasonYear: 2026,
    memberUserId: STUDENT,
    memberName: "Riley",
    amountUsd: "15.00",
    description: "Zip ties",
    categoryId: null,
    categoryName: null,
    purchasedOn: null,
    status: "submitted",
    decisionNote: null,
    approverName: null,
    submittedAt: "2026-10-11T00:00:00Z",
    decidedAt: null,
    paidAt: null,
    hasReceipt: true,
    receiptByteSize: 1000,
    receiptChecksum: "a".repeat(64),
    createdAt: "2026-10-11T00:00:00Z",
    updatedAt: "2026-10-11T00:00:00Z",
    ...overrides,
  };
}

function patch(body: Record<string, unknown>) {
  return route.PATCH(
    new Request(`http://localhost/api/reimbursements/${CLAIM}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: ORG, ...body }),
    }),
    { params: Promise.resolve({ id: CLAIM }) },
  );
}

const updates = () => state.queries.filter((q) => /^\s*UPDATE reimbursement_requests/.test(q.sql));

beforeEach(() => {
  state.userId = TREASURER;
  state.canManage = true;
  state.claim = claimRow();
  state.queries = [];
});

describe("nobody approves or pays their own claim", () => {
  it("refuses a finance manager approving a claim they filed, before any write", async () => {
    state.claim = claimRow({ memberUserId: TREASURER });
    const response = await patch({ action: "approve" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(OWN_CLAIM_DECISION);
    expect(updates()).toEqual([]);
  });

  it("refuses marking their own approved claim paid", async () => {
    state.claim = claimRow({ memberUserId: TREASURER, status: "approved", approverName: "Owner", decidedAt: "2026-10-11T00:00:00Z" });
    const response = await patch({ action: "mark_paid" });
    expect(response.status).toBe(409);
    expect(updates()).toEqual([]);
  });

  it("lets a finance manager approve someone else's claim", async () => {
    const response = await patch({ action: "approve" });
    expect(response.status).toBe(200);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.sql).toContain("status = 'approved'");
  });

  it("refuses a finance manager withdrawing someone else's claim", async () => {
    const response = await patch({ action: "withdraw" });
    expect(response.status).toBe(409);
    expect(updates()).toEqual([]);
  });
});

describe("a denial carries a reason", () => {
  it("refuses a denial with no reason", async () => {
    const response = await patch({ action: "deny", decisionNote: "  " });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/say why/i);
    expect(updates()).toEqual([]);
  });

  it("stores the reason with the denial", async () => {
    const response = await patch({ action: "deny", decisionNote: "The receipt is cut off." });
    expect(response.status).toBe(200);
    expect(updates()[0]!.params).toContain("The receipt is cut off.");
  });
});

describe("reopening keeps the history", () => {
  it("a student reopening a denied claim keeps the denial note and date", async () => {
    state.userId = STUDENT;
    state.canManage = false;
    state.claim = claimRow({ status: "denied", decisionNote: "Cut off", approverName: "Owner", decidedAt: "2026-10-11T00:00:00Z" });
    const response = await patch({ action: "reopen" });
    expect(response.status).toBe(200);
    const sql = updates()[0]!.sql;
    expect(sql).toContain("approver_user_id = NULL");
    expect(sql).not.toContain("decision_note");
    expect(sql).not.toContain("decided_at");
  });

  it("resubmitting keeps it too, until the next decision replaces it", async () => {
    state.userId = STUDENT;
    state.canManage = false;
    state.claim = claimRow({ status: "draft", decisionNote: "Cut off", decidedAt: "2026-10-11T00:00:00Z" });
    const response = await patch({ action: "submit" });
    expect(response.status).toBe(200);
    expect(updates()[0]!.sql).not.toContain("decision_note");
  });
});
