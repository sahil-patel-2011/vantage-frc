import { beforeEach, describe, expect, it, vi } from "vitest";

const TEAM = "97d33e82-3d2d-4cf4-adba-727d777ba243";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string }; session: { createdAt: Date } },
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  scopes: [] as Array<{ userId: string; orgId?: string }>,
  failWith: null as unknown,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@vantage/db", () => ({
  withRls: async (scope: { userId: string; orgId?: string }, work: (client: unknown) => Promise<unknown>) => {
    state.scopes.push(scope);
    return work({
      query: async (sql: string, params: unknown[] = []) => {
        state.queries.push({ sql, params });
        if (state.failWith && /leave_team|delete_team|delete_my_account/.test(sql)) throw state.failWith;
        return { rows: state.rows, rowCount: state.rows.length };
      },
    });
  },
}));

const lifecycle = await import("../../app/api/organizations/lifecycle/route");
const account = await import("../../app/api/account/delete/route");

function request(method: string, body?: unknown, query = "") {
  return new Request(`https://vantage.example/api/organizations/lifecycle${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = { user: { id: "user-1" }, session: { createdAt: new Date() } };
  state.queries = [];
  state.scopes = [];
  state.failWith = null;
  state.rows = [];
});

describe("leaving a team", () => {
  it("leaves through leave_team as the person, and forgets the remembered team", async () => {
    const response = await lifecycle.POST(request("POST", { orgId: TEAM, action: "leave" }));
    expect(response.status).toBe(200);
    expect(state.scopes[0]).toEqual({ userId: "user-1", orgId: TEAM });
    expect(state.queries[0]).toEqual({ sql: "SELECT leave_team($1::uuid)", params: [TEAM] });
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("vantage-team=;"))).toBe(true);
  });

  it("explains the last owner's refusal instead of failing", async () => {
    state.failWith = Object.assign(new Error("Hand the team over before you leave"), { code: "42501", detail: "vantage:last_owner" });
    const response = await lifecycle.POST(request("POST", { orgId: TEAM, action: "leave" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "last_owner", error: expect.stringMatching(/Hand the team over/) });
  });

  it("refuses a team id that is not one", async () => {
    const response = await lifecycle.POST(request("POST", { orgId: "6925", action: "leave" }));
    expect(response.status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });

  it("hides an unexpected database error behind a plain sentence", async () => {
    state.failWith = Object.assign(new Error('relation "memberships" does not exist'), { code: "42P01" });
    const response = await lifecycle.POST(request("POST", { orgId: TEAM, action: "leave" }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("You're still on the team. Try again in a minute.");
  });
});

describe("deleting a team", () => {
  it("passes the typed number to delete_team", async () => {
    const response = await lifecycle.DELETE(request("DELETE", { orgId: TEAM, confirm: "9201" }));
    expect(response.status).toBe(200);
    expect(state.queries[0]).toEqual({ sql: "SELECT delete_team($1::uuid, $2::text)", params: [TEAM, "9201"] });
  });

  it("asks for a fresh sign-in before touching the database", async () => {
    state.session = { user: { id: "user-1" }, session: { createdAt: new Date(Date.now() - 3 * 86_400_000) } };
    const response = await lifecycle.DELETE(request("DELETE", { orgId: TEAM, confirm: "9201" }));
    expect(response.status).toBe(403);
    expect((await response.json()).reason).toBe("reauth_required");
    expect(state.queries).toHaveLength(0);
  });

  it("says a paid plan is cancelled first", async () => {
    state.failWith = Object.assign(new Error("Cancel the paid plan first"), { code: "55000", detail: "vantage:paid_plan" });
    const response = await lifecycle.DELETE(request("DELETE", { orgId: TEAM, confirm: "9201" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Cancel it in Billing first/);
  });
});

describe("renaming a team", () => {
  it("updates the name for an owner and records it", async () => {
    state.rows = [{ orgId: TEAM, name: "QA 2 Alpah", teamNumber: 9201, role: "owner", memberCount: 4, ownerCount: 1, paidPlan: false }];
    const response = await lifecycle.PATCH(request("PATCH", { orgId: TEAM, name: "  QA 2  Alpha " }));
    expect(response.status).toBe(200);
    const update = state.queries.find((query) => query.sql.startsWith("UPDATE organizations"));
    expect(update?.params).toEqual([TEAM, "QA 2 Alpha"]);
    expect(state.queries.some((query) => query.sql.includes("'team.renamed'"))).toBe(true);
  });

  it("refuses a team member", async () => {
    state.rows = [{ orgId: TEAM, name: "QA 2 Alpha", teamNumber: 9201, role: "scout", memberCount: 4, ownerCount: 1, paidPlan: false }];
    const response = await lifecycle.PATCH(request("PATCH", { orgId: TEAM, name: "Renamed" }));
    expect(response.status).toBe(403);
    expect(state.queries.some((query) => query.sql.startsWith("UPDATE organizations"))).toBe(false);
  });
});

describe("deleting my account", () => {
  function accountRequest(body: unknown) {
    return new Request("https://vantage.example/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("deletes through delete_my_account and signs the browser out", async () => {
    const response = await account.POST(accountRequest({ confirm: "me@example.test" }));
    expect(response.status).toBe(200);
    expect(state.scopes[0]).toEqual({ userId: "user-1" });
    expect(state.queries[0]).toEqual({ sql: "SELECT delete_my_account($1::text)", params: ["me@example.test"] });
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("better-auth.session_token=;"))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("__Secure-better-auth.session_token=;") && cookie.includes("Secure"))).toBe(true);
  });

  it("tells a team's only owner to hand it over first", async () => {
    state.failWith = Object.assign(new Error("Hand over or delete your team first"), { code: "42501", detail: "vantage:last_owner" });
    const response = await account.POST(accountRequest({ confirm: "me@example.test" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Hand that team over/);
  });

  it("needs a session", async () => {
    state.session = null;
    expect((await account.POST(accountRequest({ confirm: "x" }))).status).toBe(401);
  });
});
