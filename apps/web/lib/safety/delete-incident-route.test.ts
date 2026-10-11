import { beforeEach, describe, expect, it, vi } from "vitest";
import { CERTIFICATION_LEADS_ONLY } from "./authorization";

/**
 * Contract for POST /api/safety after incident reporting was removed. The parser runs for
 * real; only the session and the `withRls` client are stubbed.
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
        if (sql.includes("INSERT INTO safety_certifications")) {
          return { rows: [{ id: "cccccccc-3333-4333-8333-333333333333" }], rowCount: 1 };
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

const INCIDENT_ACTIONS = [
  { action: "delete_incident", orgId: ORG, id: INCIDENT },
  { action: "set_incident_status", orgId: ORG, id: INCIDENT, status: "closed" },
  { action: "log_incident", orgId: ORG, title: "Pinched finger", severity: "minor", occurredOn: "2026-10-01" },
] as const;

beforeEach(() => {
  state.session = null;
  state.role = null;
  state.withRlsContext = null;
  state.queries = [];
});

/**
 * Incident reporting was removed from Vantage; Safety keeps tool training and tool
 * certifications. The incident actions still parse (old clients may send them) but the route
 * answers 410 and never opens a database transaction for them.
 */
describe("POST /api/safety refuses the removed incident actions", () => {
  it("returns 401 when there is no session", async () => {
    const response = await post(INCIDENT_ACTIONS[0]);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(state.withRlsContext).toBeNull();
  });

  for (const body of INCIDENT_ACTIONS) {
    it(`answers 410 for ${body.action} and touches no table`, async () => {
      state.session = { user: { id: USER } };
      state.role = "owner";
      const response = await post(body);
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({
        error: "Incident reporting was removed. Tool certifications are still here.",
      });
      expect(state.withRlsContext).toBeNull();
      expect(state.queries).toHaveLength(0);
    });
  }

  it("still records a tool certification through withRls", async () => {
    state.session = { user: { id: USER } };
    state.role = "owner";
    const response = await post({
      action: "add_certification",
      orgId: ORG,
      personName: "Riley",
      certType: "general_safety",
      completedOn: "2026-10-01",
    });
    expect(state.withRlsContext).toEqual({ userId: USER, orgId: ORG });
    expect(state.queries.some((q) => q.sql.includes("INSERT INTO safety_certifications"))).toBe(true);
    expect(response.status).not.toBe(410);
  });
});

/** A certification is a lead's attestation (A5-15, migration 0723), never a student's own entry. */
describe("POST /api/safety: only an owner or admin records or removes a certification", () => {
  for (const role of ["scout", "viewer"]) {
    it(`refuses a ${role} recording one, for themselves or anyone, before any write`, async () => {
      state.session = { user: { id: USER } };
      state.role = role;
      const response = await post({
        action: "add_certification",
        orgId: ORG,
        personName: "QA5 Self Certified",
        certType: "bandsaw",
        completedOn: "2026-10-01",
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: CERTIFICATION_LEADS_ONLY });
      expect(state.queries.some((q) => /INSERT|DELETE/.test(q.sql))).toBe(false);
    });
  }

  it("refuses a scout deleting one", async () => {
    state.session = { user: { id: USER } };
    state.role = "scout";
    const response = await post({ action: "delete_certification", orgId: ORG, id: INCIDENT });
    expect(response.status).toBe(403);
    expect(state.queries.some((q) => q.sql.includes("DELETE FROM safety_certifications"))).toBe(false);
  });

  it("lets an admin record one", async () => {
    state.session = { user: { id: USER } };
    state.role = "admin";
    const response = await post({
      action: "add_certification",
      orgId: ORG,
      personName: "Riley",
      certType: "bandsaw",
      completedOn: "2026-10-01",
    });
    expect(response.status).toBe(200);
    expect(state.queries.some((q) => q.sql.includes("INSERT INTO safety_certifications"))).toBe(true);
  });
});
