import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCanDeleteSafetyIncident,
  canDeleteSafetyIncident,
  deleteSafetyIncident,
  SafetyAuthError,
} from "./authorization";

const SAFETY_DELETE_MIGRATION = readFileSync(
  new URL("../../../../packages/db/migrations/0502_safety_delete_owner_admin.sql", import.meta.url),
  "utf8",
);

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const INCIDENT = "aaaaaaaa-1111-4111-8111-111111111111";
const ADA = "bbbbbbbb-2222-4222-8222-222222222222";
const SAM = "cccccccc-3333-4333-8333-333333333333";

type Call = { sql: string; params: unknown[] };

/**
 * Stands in for the RLS-scoped PoolClient. Memberships and incidents are keyed by org so
 * an id belonging to another team reads as "not found" here, the same way it would under RLS.
 */
function mockClient(fixtures: {
  memberships?: Array<{ orgId: string; userId: string; role: string }>;
  incidents?: Array<{ orgId: string; id: string }>;
}) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM memberships")) {
        const [orgId, userId] = params as [string, string];
        const rows = (fixtures.memberships ?? []).filter(
          (m) => m.orgId === orgId && m.userId === userId,
        );
        return { rows: rows.map((m) => ({ role: m.role })), rowCount: rows.length };
      }
      if (sql.includes("DELETE FROM safety_incidents")) {
        const [id, orgId] = params as [string, string];
        const rows = (fixtures.incidents ?? []).filter((i) => i.id === id && i.orgId === orgId);
        return { rows: [], rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
  return { client, calls };
}

const deletes = (calls: Call[]) => calls.filter((call) => call.sql.includes("DELETE FROM safety_incidents"));

describe("canDeleteSafetyIncident", () => {
  it("admits owner and admin only", () => {
    expect(canDeleteSafetyIncident("owner")).toBe(true);
    expect(canDeleteSafetyIncident("admin")).toBe(true);
  });

  it("refuses every student-facing and unknown role, including the reporter", () => {
    for (const role of ["scout", "viewer", "member", "student", "mentor", "", null, undefined]) {
      expect(canDeleteSafetyIncident(role)).toBe(false);
    }
  });
});

describe("assertCanDeleteSafetyIncident", () => {
  it("passes a manager through", () => {
    expect(() => assertCanDeleteSafetyIncident("owner")).not.toThrow();
    expect(() => assertCanDeleteSafetyIncident("admin")).not.toThrow();
  });

  it("raises 403 naming the rule so a student knows why it was blocked", () => {
    try {
      assertCanDeleteSafetyIncident("scout");
      throw new Error("expected a SafetyAuthError");
    } catch (error) {
      expect(error).toBeInstanceOf(SafetyAuthError);
      expect((error as SafetyAuthError).status).toBe(403);
      expect((error as Error).message).toBe("Only an owner or admin can delete a safety incident.");
    }
  });
});

describe("deleteSafetyIncident", () => {
  it("lets an owner erase an incident on their team with org-scoped parameterized SQL", async () => {
    const { client, calls } = mockClient({
      memberships: [{ orgId: ORG, userId: ADA, role: "owner" }],
      incidents: [{ orgId: ORG, id: INCIDENT }],
    });

    await expect(
      deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: ADA }),
    ).resolves.toBeUndefined();

    const written = deletes(calls);
    expect(written).toHaveLength(1);
    expect(written[0]!.sql).toMatch(/id = \$1::uuid/);
    expect(written[0]!.sql).toMatch(/org_id = \$2::uuid/);
    expect(written[0]!.params).toEqual([INCIDENT, ORG]);
    expect(written[0]!.sql).not.toMatch(/DEMO/i);
    expect(JSON.stringify(written[0]!.params)).not.toMatch(/DEMO/i);
  });

  it("lets an admin erase an incident on their team", async () => {
    const { client, calls } = mockClient({
      memberships: [{ orgId: ORG, userId: ADA, role: "admin" }],
      incidents: [{ orgId: ORG, id: INCIDENT }],
    });

    await deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: ADA });
    expect(deletes(calls)).toHaveLength(1);
  });

  it("never issues DELETE for a scout, including the member who reported the row", async () => {
    const { client, calls } = mockClient({
      memberships: [{ orgId: ORG, userId: SAM, role: "scout" }],
      incidents: [{ orgId: ORG, id: INCIDENT }],
    });

    await expect(
      deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: SAM }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Only an owner or admin can delete a safety incident.",
    });
    expect(deletes(calls)).toHaveLength(0);
  });

  it("never issues DELETE for a viewer", async () => {
    const { client, calls } = mockClient({
      memberships: [{ orgId: ORG, userId: SAM, role: "viewer" }],
      incidents: [{ orgId: ORG, id: INCIDENT }],
    });

    await expect(
      deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: SAM }),
    ).rejects.toBeInstanceOf(SafetyAuthError);
    expect(deletes(calls)).toHaveLength(0);
  });

  it("does not carry an owner role across org boundaries", async () => {
    const { client, calls } = mockClient({
      memberships: [
        { orgId: OTHER_ORG, userId: ADA, role: "owner" },
        { orgId: ORG, userId: ADA, role: "scout" },
      ],
      incidents: [{ orgId: ORG, id: INCIDENT }],
    });

    await expect(
      deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: ADA }),
    ).rejects.toMatchObject({ status: 403 });
    expect(deletes(calls)).toHaveLength(0);
  });

  it("refuses a non-member without confirming the incident exists", async () => {
    const { client, calls } = mockClient({
      memberships: [{ orgId: OTHER_ORG, userId: SAM, role: "owner" }],
      incidents: [{ orgId: ORG, id: INCIDENT }],
    });

    await expect(
      deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: SAM }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Organization membership required",
    });
    expect(deletes(calls)).toHaveLength(0);
  });

  it("cannot delete an incident id that belongs to another team", async () => {
    const { client, calls } = mockClient({
      memberships: [{ orgId: ORG, userId: ADA, role: "admin" }],
      incidents: [{ orgId: OTHER_ORG, id: INCIDENT }],
    });

    await expect(
      deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: ADA }),
    ).rejects.toMatchObject({
      status: 404,
      message: "Incident not found",
    });
    expect(deletes(calls)).toHaveLength(1);
    expect(deletes(calls)[0]!.params[1]).toBe(ORG);
  });

  it("looks up the caller's role with parameterized org and user ids", async () => {
    const { client, calls } = mockClient({
      memberships: [{ orgId: ORG, userId: ADA, role: "admin" }],
      incidents: [{ orgId: ORG, id: INCIDENT }],
    });

    await deleteSafetyIncident(client, { orgId: ORG, incidentId: INCIDENT, userId: ADA });
    const roleLookup = calls.find((call) => call.sql.includes("FROM memberships"));
    expect(roleLookup?.sql).toMatch(/org_id = \$1::uuid/);
    expect(roleLookup?.sql).toMatch(/user_id = \$2::uuid/);
    expect(roleLookup?.params).toEqual([ORG, ADA]);
  });
});

describe("0502 safety delete RLS", () => {
  it("replaces the incident DELETE policy with owner/admin only", () => {
    expect(SAFETY_DELETE_MIGRATION).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SAFETY_DELETE_MIGRATION).toMatch(
      /DROP POLICY IF EXISTS safety_incidents_delete ON safety_incidents/,
    );
    expect(SAFETY_DELETE_MIGRATION).toMatch(
      /CREATE POLICY safety_incidents_delete ON safety_incidents/,
    );
    expect(SAFETY_DELETE_MIGRATION).toContain(
      "has_org_role(org_id, ARRAY['owner','admin']::org_role[])",
    );
    expect(SAFETY_DELETE_MIGRATION).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON safety_incidents/,
    );
    expect(SAFETY_DELETE_MIGRATION).not.toMatch(/reported_by/);
    expect(SAFETY_DELETE_MIGRATION).not.toMatch(/current_app_user_id\s*\(/);
  });
});
