/**
 * Route-level proof of the 0714 money rule: every money write asks
 * can_manage_finances() before it touches a table, refuses everyone else with
 * the same plain sentence and a 403, and writes nothing on the way out.
 *
 * The database is a fake that answers by SQL shape; RLS itself is proven
 * against a real PostgreSQL in packages/db/src/finance-managers-integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const GRANT = "33333333-3333-4333-8333-333333333333";
const TXN = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const SENTENCE = "Only people your team owner chose can change money. Ask an owner for access.";

type Query = { sql: string; params: unknown[] };

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  role: "admin" as string,
  canManage: false,
  targetRole: "scout" as string,
  queries: [] as Query[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
  assertSponsorsAllowed: async () => undefined,
  assertHubTabAccess: async () => undefined,
  emitPreferredNotification: async () => undefined,
}));

function respond(sql: string, params: unknown[]) {
  state.queries.push({ sql, params });
  if (sql.includes("can_manage_finances")) return { rowCount: 1, rows: [{ allowed: state.canManage }] };
  // resolveMembership (org-capabilities) joins organizations.
  if (sql.includes("FROM memberships m") && sql.includes("JOIN organizations o")) {
    return {
      rowCount: 1,
      rows: [{ orgId: ORG, orgName: "Team 6925", teamNumber: 6925, role: state.role }],
    };
  }
  // The grantee lookup in grantCapability.
  if (sql.includes("FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid") && params[1] === TARGET) {
    return { rowCount: 1, rows: [{ role: state.targetRole }] };
  }
  if (sql.includes("FROM memberships")) return { rowCount: 1, rows: [{ role: state.role }] };
  if (sql.includes("INSERT INTO membership_capabilities")) return { rowCount: 1, rows: [] };
  if (sql.includes("FROM purchase_requests WHERE id=$1")) {
    return {
      rowCount: 1,
      rows: [{ status: "pending", requestedBy: TARGET, categoryId: null, totalCostUsd: "40.00", seasonYear: 2026 }],
    };
  }
  return { rowCount: 0, rows: [] };
}

vi.mock("@vantage/db", () => {
  const client = { query: async (sql: string, params: unknown[] = []) => respond(sql, params) };
  return {
    withRls: async (_context: unknown, work: (c: typeof client) => Promise<unknown>) => work(client),
    withSavepoint: async (_c: unknown, work: () => Promise<unknown>, fallback: unknown) => {
      try {
        return await work();
      } catch {
        return fallback;
      }
    },
    withSavepointOrThrow: async (_c: unknown, work: () => Promise<unknown>) => work(),
  };
});

const categories = await import("../../app/api/finance/categories/route");
const budget = await import("../../app/api/finance/budget/route");
const purchaseRequests = await import("../../app/api/finance/purchase-requests/route");
const costs = await import("../../app/api/costs/route");
const fundraisers = await import("../../app/api/fundraisers/route");
const allocations = await import("../../app/api/grants/allocations/route");
const seasonFinance = await import("../../app/api/business/finance/route");
const managers = await import("../../app/api/finance/managers/route");

function post(body: Record<string, unknown>, method = "POST") {
  return new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Statements that would change data — none may run for a refused caller. */
function writes(): string[] {
  return state.queries
    .map((query) => query.sql)
    .filter((sql) => /^\s*(WITH[\s\S]*)?(INSERT|UPDATE|DELETE)\b/i.test(sql.trim()) || /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b/i.test(sql));
}

async function expectRefused(response: Response) {
  expect(response.status).toBe(403);
  const body = (await response.json()) as { error?: string };
  expect(body.error).toBe(SENTENCE);
  expect(writes()).toEqual([]);
}

beforeEach(() => {
  state.session = { user: { id: USER } };
  state.role = "admin";
  state.canManage = false;
  state.targetRole = "scout";
  state.queries = [];
});

describe("money writes refuse anyone the owner did not choose — including admins", () => {
  it("category budgets", async () => {
    await expectRefused(
      await budget.POST(post({ orgId: ORG, seasonYear: 2026, categoryName: "Parts", totalLimitUsd: 500 })),
    );
  });

  it("spending categories", async () => {
    await expectRefused(await categories.POST(post({ orgId: ORG, seasonYear: 2026, name: "Travel" })));
  });

  it("purchase-request decisions", async () => {
    await expectRefused(await purchaseRequests.PATCH(post({ orgId: ORG, id: REQUEST, action: "approve" }, "PATCH")));
  });

  it("season costs", async () => {
    state.role = "scout";
    await expectRefused(
      await costs.POST(
        post({ orgId: ORG, action: "add-cost", label: "Registration", incurredOn: "2026-02-01", amountUsd: 5000 }),
      ),
    );
  });

  it("fundraiser proceeds", async () => {
    state.role = "scout";
    await expectRefused(await fundraisers.POST(post({ orgId: ORG, action: "record_proceeds", id: REQUEST, amountUsd: 120 })));
  });

  it("grant allocations", async () => {
    await expectRefused(
      await allocations.POST(
        post({ orgId: ORG, grantApplicationId: GRANT, financeTransactionId: TXN, amountUsd: 25 }),
      ),
    );
  });

  it("the Money desk purchase log", async () => {
    state.role = "scout";
    await expectRefused(
      await seasonFinance.POST(
        post({ orgId: ORG, action: "add-purchase", vendor: "McMaster", item: "Bolts", amountUsd: 12, purchasedOn: "2026-02-01" }),
      ),
    );
  });
});

describe("a finance manager gets through to the write", () => {
  it("records a spending category", async () => {
    state.canManage = true;
    const response = await categories.POST(post({ orgId: ORG, seasonYear: 2026, name: "Travel" }));
    expect(response.status).toBe(200);
    expect(writes().some((sql) => sql.includes("INSERT INTO finance_categories"))).toBe(true);
  });

  it("decides a purchase request", async () => {
    state.canManage = true;
    state.role = "scout"; // a team member the owner chose
    const response = await purchaseRequests.PATCH(post({ orgId: ORG, id: REQUEST, action: "approve" }, "PATCH"));
    expect(response.status).toBe(200);
    expect(writes().some((sql) => sql.includes("UPDATE purchase_requests SET status"))).toBe(true);
  });
});

describe("finance GETs tell the page whether to show money controls", () => {
  it("includes canManageFinances on the category list", async () => {
    state.canManage = true;
    const response = await categories.GET(new Request(`http://localhost/api/finance/categories?orgId=${ORG}`));
    await expect(response.json()).resolves.toMatchObject({ canManageFinances: true });
    state.canManage = false;
    const denied = await categories.GET(new Request(`http://localhost/api/finance/categories?orgId=${ORG}`));
    await expect(denied.json()).resolves.toMatchObject({ canManageFinances: false });
  });
});

describe("/api/finance/managers — only the owner chooses", () => {
  it("refuses an admin trying to hand out Manage money", async () => {
    state.role = "admin";
    const response = await managers.POST(post({ orgId: ORG, action: "grant", userId: TARGET }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Only the team owner can choose who manages money." });
    expect(writes()).toEqual([]);
  });

  it("refuses a self-grant before the database has to", async () => {
    state.role = "owner";
    const response = await managers.POST(post({ orgId: ORG, action: "grant", userId: USER }));
    expect(response.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("refuses a view-only person with the next step, not a policy error", async () => {
    state.role = "owner";
    state.targetRole = "viewer";
    const response = await managers.POST(post({ orgId: ORG, action: "grant", userId: TARGET }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      // In the role words (QA A3-06): never "Team member or Team admin".
      error: "A parent or guest can't manage money. Change their access to Student or Mentor or coach first.",
    });
    expect(writes()).toEqual([]);
  });

  it("lets the owner grant a team member", async () => {
    state.role = "owner";
    state.canManage = true;
    const response = await managers.POST(post({ orgId: ORG, action: "grant", userId: TARGET }));
    expect(response.status).toBe(200);
    const insert = state.queries.find((query) => query.sql.includes("INSERT INTO membership_capabilities"));
    expect(insert?.params).toEqual([ORG, TARGET, "manage_budget", USER]);
  });

  it("shows any member who manages money, read-only", async () => {
    state.role = "scout";
    const response = await managers.GET(new Request(`http://localhost/api/finance/managers?orgId=${ORG}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ canChoose: false, canManageFinances: false, candidates: [] });
  });
});
