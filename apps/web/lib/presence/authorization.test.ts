import { describe, expect, it } from "vitest";
import {
  assertCanManagePresence,
  assertCanRecordPresence,
  assertCanTouchHourLog,
  assertRosterMember,
  canManagePresence,
  loadHourLogOwner,
  PresenceAuthError,
  requirePresenceRole,
} from "./authorization";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const ADA = "aaaaaaaa-1111-4111-8111-111111111111";
const GRACE = "bbbbbbbb-2222-4222-8222-222222222222";
const OUTSIDER = "cccccccc-3333-4333-8333-333333333333";

/**
 * Stands in for the RLS-scoped PoolClient. `memberships` and `hour_logs` are keyed by org so the
 * tests can prove that an id belonging to another team reads as "not found" here, exactly as it
 * would under RLS in production.
 */
function mockClient(fixtures: {
  memberships?: Array<{ orgId: string; userId: string; role: string }>;
  hourLogs?: Array<{ orgId: string; id: string; userId: string }>;
}) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM memberships")) {
        const [orgId, userId] = params as [string, string];
        const rows = (fixtures.memberships ?? []).filter(
          (m) => m.orgId === orgId && m.userId === userId,
        );
        return { rows: rows.map((m) => ({ role: m.role })), rowCount: rows.length };
      }
      if (sql.includes("FROM hour_logs")) {
        const [orgId, id] = params as [string, string];
        const rows = (fixtures.hourLogs ?? []).filter((l) => l.orgId === orgId && l.id === id);
        return { rows: rows.map((l) => ({ userId: l.userId })), rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("canManagePresence", () => {
  it("recognises owners and admins only", () => {
    expect(canManagePresence("owner")).toBe(true);
    expect(canManagePresence("admin")).toBe(true);
    expect(canManagePresence("member")).toBe(false);
    expect(canManagePresence("mentor")).toBe(false);
    expect(canManagePresence(null)).toBe(false);
    expect(canManagePresence(undefined)).toBe(false);
  });
});

describe("requirePresenceRole", () => {
  it("returns the caller's role on their own team", async () => {
    const client = mockClient({ memberships: [{ orgId: ORG, userId: ADA, role: "admin" }] });
    await expect(requirePresenceRole(client, ORG, ADA)).resolves.toBe("admin");
  });

  it("denies a member of a different org without confirming the org exists", async () => {
    const client = mockClient({ memberships: [{ orgId: OTHER_ORG, userId: OUTSIDER, role: "owner" }] });
    await expect(requirePresenceRole(client, ORG, OUTSIDER)).rejects.toMatchObject({
      status: 403,
      message: "Organization access denied",
    });
  });

  it("does not carry an owner role across org boundaries", async () => {
    const client = mockClient({
      memberships: [
        { orgId: OTHER_ORG, userId: ADA, role: "owner" },
        { orgId: ORG, userId: ADA, role: "member" },
      ],
    });
    await expect(requirePresenceRole(client, ORG, ADA)).resolves.toBe("member");
  });
});

describe("assertRosterMember", () => {
  it("accepts a member of this team", async () => {
    const client = mockClient({ memberships: [{ orgId: ORG, userId: GRACE, role: "member" }] });
    await expect(assertRosterMember(client, ORG, GRACE)).resolves.toBeUndefined();
  });

  it("rejects a user id that belongs to another team", async () => {
    const client = mockClient({ memberships: [{ orgId: OTHER_ORG, userId: OUTSIDER, role: "member" }] });
    await expect(assertRosterMember(client, ORG, OUTSIDER)).rejects.toBeInstanceOf(PresenceAuthError);
  });

  it("uses the same message for a nonexistent user as for another team's user", async () => {
    const client = mockClient({ memberships: [{ orgId: OTHER_ORG, userId: OUTSIDER, role: "member" }] });
    const foreign = await assertRosterMember(client, ORG, OUTSIDER).catch((e: Error) => e.message);
    const missing = await assertRosterMember(client, ORG, "ffffffff-4444-4444-8444-444444444444").catch(
      (e: Error) => e.message,
    );
    expect(foreign).toBe(missing);
  });
});

describe("loadHourLogOwner", () => {
  it("returns the owner of a session on this team", async () => {
    const client = mockClient({ hourLogs: [{ orgId: ORG, id: "log-1", userId: GRACE }] });
    await expect(loadHourLogOwner(client, ORG, "log-1")).resolves.toBe(GRACE);
  });

  it("cannot read a session id belonging to another team", async () => {
    const client = mockClient({ hourLogs: [{ orgId: OTHER_ORG, id: "log-9", userId: OUTSIDER }] });
    await expect(loadHourLogOwner(client, ORG, "log-9")).rejects.toMatchObject({
      message: "That shop session was not found.",
    });
  });
});

describe("assertCanRecordPresence", () => {
  it("lets a member record their own presence", () => {
    expect(() =>
      assertCanRecordPresence({ role: "member", actorId: ADA, targetUserId: ADA }),
    ).not.toThrow();
  });

  it("stops a member recording presence for a teammate", () => {
    expect(() =>
      assertCanRecordPresence({ role: "member", actorId: ADA, targetUserId: GRACE }),
    ).toThrow(PresenceAuthError);
  });

  it("lets an admin record presence for a teammate", () => {
    expect(() =>
      assertCanRecordPresence({ role: "admin", actorId: ADA, targetUserId: GRACE }),
    ).not.toThrow();
  });
});

describe("assertCanTouchHourLog", () => {
  it("lets a member attach and detach their own session", () => {
    for (const verb of ["attach", "detach"] as const) {
      expect(() =>
        assertCanTouchHourLog({ role: "member", actorId: ADA, ownerId: ADA, verb }),
      ).not.toThrow();
    }
  });

  it("stops a member attaching a teammate's session to a meeting", () => {
    expect(() =>
      assertCanTouchHourLog({ role: "member", actorId: ADA, ownerId: GRACE, verb: "attach" }),
    ).toThrow(/attach another member's shop session/);
  });

  it("stops a member detaching a teammate's session", () => {
    expect(() =>
      assertCanTouchHourLog({ role: "member", actorId: ADA, ownerId: GRACE, verb: "detach" }),
    ).toThrow(/detach another member's shop session/);
  });

  it("lets an owner move a teammate's session", () => {
    expect(() =>
      assertCanTouchHourLog({ role: "owner", actorId: ADA, ownerId: GRACE, verb: "attach" }),
    ).not.toThrow();
  });
});

describe("assertCanManagePresence", () => {
  it("keeps roll-call identity linking to owners and admins", () => {
    expect(() =>
      assertCanManagePresence({ role: "member", action: "link-attendance-person" }),
    ).toThrow(/link roll-call names/);
    expect(() =>
      assertCanManagePresence({ role: "admin", action: "link-attendance-person" }),
    ).not.toThrow();
  });

  it("keeps deleting a presence record to owners and admins, even on your own row", () => {
    expect(() => assertCanManagePresence({ role: "member", action: "unlink-presence" })).toThrow(
      /remove a presence record/,
    );
    expect(() => assertCanManagePresence({ role: "owner", action: "unlink-presence" })).not.toThrow();
  });

  it("raises 403 rather than a generic bad request", () => {
    try {
      assertCanManagePresence({ role: "member", action: "unlink-presence" });
      throw new Error("expected a PresenceAuthError");
    } catch (error) {
      expect(error).toBeInstanceOf(PresenceAuthError);
      expect((error as PresenceAuthError).status).toBe(403);
    }
  });
});
