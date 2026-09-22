import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  session: { user: { id: "11111111-1111-4111-8111-111111111111" } } as { user: { id: string } } | null,
  claims: 0,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  failAttestationInsert: null as null | { code: string; message: string },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
  assertLegalAccepted: (flags: { termsAccepted?: boolean; privacyAccepted?: boolean }) => {
    if (flags.termsAccepted !== true || flags.privacyAccepted !== true) {
      throw new Error("Agree to the Terms of Service and the Privacy Policy to continue.");
    }
  },
  recordLegalAcceptance: async () => undefined,
  claimFrcTeamWorkspace: async () => {
    state.claims += 1;
    return "22222222-2222-4222-8222-222222222222";
  },
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, params: unknown[] = []) => {
        state.queries.push({ sql, params });
        if (sql.includes("INSERT INTO team_claim_attestations") && state.failAttestationInsert) {
          throw Object.assign(new Error(state.failAttestationInsert.message), {
            code: state.failAttestationInsert.code,
          });
        }
        return { rows: [], rowCount: 1 };
      },
    }),
}));

const { POST } = await import("../../app/api/organizations/claim/route");
const { TEAM_CLAIM_STATEMENT_VERSION, teamClaimStatement } = await import("./attestation");

function post(body: Record<string, unknown>, ip?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ip) headers["x-forwarded-for"] = ip;
  return POST(
    new Request("http://localhost/api/organizations/claim", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

const valid = {
  name: "Test Robotics",
  slug: "test-robotics",
  teamNumber: 9999,
  termsAccepted: true,
  privacyAccepted: true,
  authorizationAcknowledged: true,
  attestationVersion: TEAM_CLAIM_STATEMENT_VERSION,
};

const attestationInserts = () => state.queries.filter((q) => q.sql.includes("INSERT INTO team_claim_attestations"));

beforeEach(() => {
  state.session = { user: { id: USER } };
  state.claims = 0;
  state.queries = [];
  state.failAttestationInsert = null;
});

describe("POST /api/organizations/claim — authorization statement", () => {
  it("rejects a claim with no acknowledgement (400) and writes nothing", async () => {
    const body: Record<string, unknown> = { ...valid };
    delete body.authorizationAcknowledged;
    const response = await post(body);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string; field?: string };
    expect(data.field).toBe("authorization");
    expect(data.error).toMatch(/authorized/i);
    expect(state.claims).toBe(0);
    expect(state.queries).toHaveLength(0);
  });

  it("rejects an acknowledgement that is not literally true", async () => {
    for (const value of [false, "true", 1, null]) {
      const response = await post({ ...valid, authorizationAcknowledged: value });
      expect(response.status, String(value)).toBe(400);
    }
    expect(state.claims).toBe(0);
  });

  it("rejects an out-of-date statement version", async () => {
    const response = await post({ ...valid, attestationVersion: "2000-01-01.1" });
    expect(response.status).toBe(400);
    expect(state.claims).toBe(0);
  });

  it("still requires both legal consents", async () => {
    const response = await post({ ...valid, privacyAccepted: false });
    expect(response.status).toBe(400);
    expect(state.claims).toBe(0);
  });

  it("returns 401 without a session", async () => {
    state.session = null;
    const response = await post(valid);
    expect(response.status).toBe(401);
  });

  it("claims and records the server-built statement with a hashed IP, never the raw IP", async () => {
    const response = await post({ ...valid, statement: "I am definitely not lying" }, "203.0.113.7");
    expect(response.status).toBe(201);
    expect(((await response.json()) as { id: string }).id).toBe(ORG);
    const inserts = attestationInserts();
    expect(inserts).toHaveLength(1);
    const [orgId, userId, teamNumber, version, statement, ipHash] = inserts[0]!.params;
    expect(orgId).toBe(ORG);
    expect(userId).toBe(USER);
    expect(teamNumber).toBe(9999);
    expect(version).toBe(TEAM_CLAIM_STATEMENT_VERSION);
    expect(statement).toBe(teamClaimStatement(9999));
    expect(ipHash).toMatch(/^[0-9a-f]{20}$/);
    expect(JSON.stringify(inserts[0]!.params)).not.toContain("203.0.113.7");
  });

  it("stores no IP hash when the request carries no address", async () => {
    const response = await post(valid);
    expect(response.status).toBe(201);
    expect(attestationInserts()[0]!.params[5]).toBeNull();
  });

  it("fails the claim (503, setup) when the attestation table is not migrated", async () => {
    state.failAttestationInsert = { code: "42P01", message: 'relation "team_claim_attestations" does not exist' };
    const response = await post(valid);
    expect(response.status).toBe(503);
    const data = (await response.json()) as { error: string; setupRequired?: boolean };
    expect(data.setupRequired).toBe(true);
    expect(data.error).not.toMatch(/relation/);
  });
});
