import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Privilege-gate contract for POST /api/safety `delete_incident`. The parser and
 * `deleteSafetyIncident` run for real. Only the session and the `withRls` client are
 * stubbed, so this proves the route actually asks withRls for the caller's org and
 * never issues DELETE for a student.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const INCIDENT = "aaaaaaaa-1111-4111-8111-111111111111";
const USER = "bbbbbbbb-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  role: null as string | null,
  withRlsContext: null as { userId: string; orgId?: string } | null,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", async () => {
  const actual = await vi.importActual<typeof import("@vantage/core")>("@vantage/core");
  return {
    ...actual,
    auth: { api: { getSession: async () => state.session } },
  };
});

vi.mock("@vantage/db", () => ({
  withRls: async (
    context: { userId: string; orgId?: string },
    work: (client: unknown) => Promise<unknown>,
  ) => {
    state.withRlsContext = context;
    return work({
      query: async (sql: string, params: unknown[] = []) => {
        state.queries.push({ sql, params });
        if (sql.includes("DELETE FROM safety_incidents")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("FROM memberships")) {
          if (!state.role) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT 1")) return { rows: [{}], rowCount: 1 };
          return { rows: [{ role: state.role }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
  },
}));

const { POST } = await import("../../app/api/safety/route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/safety", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const deleteBody = { action: "delete_incident", orgId: ORG, id: INCIDENT };

beforeEach(() => {
  state.session = null;
  state.role = null;
  state.withRlsContext = null;
  state.queries = [];
});

describe("POST /api/safety delete_incident privilege gate", () => {
  it("returns 401 when there is no session", async () => {
    const response = await post(deleteBody);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(state.withRlsContext).toBeNull();
  });

  it("scopes the write through withRls with the caller's user and org", async () => {
    state.session = { user: { id: USER } };
    state.role = "owner";
    const response = await post(deleteBody);
    expect(response.status).toBe(200);
    expect(state.withRlsContext).toEqual({ userId: USER, orgId: ORG });
  });

  it("lets an owner delete and parameterizes the incident and org ids", async () => {
    state.session = { user: { id: USER } };
    state.role = "owner";
    const response = await post(deleteBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const deleted = state.queries.filter((q) => q.sql.includes("DELETE FROM safety_incidents"));
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.sql).toMatch(/\$1::uuid/);
    expect(deleted[0]!.sql).toMatch(/\$2::uuid/);
    expect(deleted[0]!.params).toEqual([INCIDENT, ORG]);
    expect(JSON.stringify(state.queries)).not.toMatch(/DEMO/i);
  });

  it("lets an admin delete", async () => {
    state.session = { user: { id: USER } };
    state.role = "admin";
    const response = await post(deleteBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 403 and never issues DELETE for a scout", async () => {
    state.session = { user: { id: USER } };
    state.role = "scout";
    const response = await post(deleteBody);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only an owner or admin can delete a safety incident.",
    });
    expect(state.queries.some((q) => q.sql.includes("DELETE FROM safety_incidents"))).toBe(false);
  });

  it("returns 403 and never issues DELETE for a viewer", async () => {
    state.session = { user: { id: USER } };
    state.role = "viewer";
    const response = await post(deleteBody);
    expect(response.status).toBe(403);
    expect(state.queries.some((q) => q.sql.includes("DELETE FROM safety_incidents"))).toBe(false);
  });
});
