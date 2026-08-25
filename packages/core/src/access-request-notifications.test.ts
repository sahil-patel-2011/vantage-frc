import { describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  ACCESS_REQUEST_NOTIFICATION_TYPES,
  accessRequestCreatedNotification,
  accessRequestDecisionNotification,
  auditMemberPasswordReset,
  notifyAccessRequestCreated,
  notifyAccessRequestDecision,
  resolveMemberForPasswordReset,
} from "./membership";
import { prefKeyForNotificationType } from "./in-app-notifications";

type Row = Record<string, unknown>;
type Call = { sql: string; params: unknown[] };

/** Minimal PoolClient double: routes by SQL substring, records every call. */
function mockClient(route: (sql: string, params: unknown[]) => Row[] | Error) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const result = route(sql, params);
      if (result instanceof Error) throw result;
      return { rows: result, rowCount: result.length };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

describe("access-request notification payloads", () => {
  it("builds the owner/admin join-request row with a Team admin deep link", () => {
    const created = accessRequestCreatedNotification({
      orgId: "org-1",
      requestId: "req-1",
      requesterName: "Dana Scout",
      teamNumber: 1234,
    });
    expect(created.type).toBe("team_access_request");
    expect(created.payload.title).toBe("Dana Scout asked to join Team 1234");
    expect(created.payload.href).toBe("/team?orgId=org-1#team-access-title");
    expect(created.payload.requestId).toBe("req-1");
  });

  it("never renders a blank requester name", () => {
    const created = accessRequestCreatedNotification({
      orgId: "org-1",
      requestId: "req-1",
      requesterName: "   ",
      teamNumber: null,
    });
    expect(created.payload.title).toBe("A new teammate asked to join this team");
  });

  it("welcomes an approved requester into the workspace", () => {
    const approved = accessRequestDecisionNotification({
      orgId: "org-1",
      requestId: "req-1",
      decision: "approved",
      teamNumber: 1234,
      grantedRole: "scout",
    });
    expect(approved.type).toBe("team_access_approved");
    expect(approved.payload.title).toBe("You're in — welcome to Team 1234");
    expect(approved.payload.body).toContain("as scout");
    expect(approved.payload.href).toBe("/workspace?orgId=org-1");
  });

  it("declines without a workspace link the requester cannot open", () => {
    const declined = accessRequestDecisionNotification({
      orgId: "org-1",
      requestId: "req-1",
      decision: "declined",
      teamNumber: 1234,
    });
    expect(declined.type).toBe("team_access_declined");
    expect(declined.payload.title).toBe("Your request to join Team 1234 was declined");
    expect("href" in declined.payload).toBe(false);
  });

  it("keeps every lifecycle type outside the mutable preference gate", () => {
    for (const type of Object.values(ACCESS_REQUEST_NOTIFICATION_TYPES)) {
      expect(prefKeyForNotificationType(type)).toBeNull();
    }
  });
});

describe("notifyAccessRequestCreated", () => {
  it("inserts one inbox row per owner/admin in the same transaction", async () => {
    const { client, calls } = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return [
          { userId: "owner-1", teamNumber: 1234 },
          { userId: "admin-1", teamNumber: 1234 },
        ];
      }
      return [];
    });
    const result = await notifyAccessRequestCreated(client, {
      orgId: "org-1",
      requestId: "req-1",
      requesterName: "Dana",
    });
    expect(result.notified).toBe(2);
    const inserts = calls.filter((call) => call.sql.includes("INSERT INTO notifications"));
    expect(inserts.map((call) => call.params[0])).toEqual(["owner-1", "admin-1"]);
    expect(inserts[0]?.params[2]).toBe("team_access_request");
  });

  it("does not abort the surrounding transaction when the inbox insert is RLS-denied", async () => {
    const { client, calls } = mockClient((sql) => {
      if (sql.includes("FROM memberships")) return [{ userId: "owner-1", teamNumber: 1234 }];
      if (sql.includes("INSERT INTO notifications")) {
        return new Error("new row violates row-level security policy");
      }
      return [];
    });
    const result = await notifyAccessRequestCreated(client, {
      orgId: "org-1",
      requestId: "req-1",
      requesterName: "Dana",
    });
    expect(result.notified).toBe(0);
    expect(calls.some((call) => call.sql.includes("ROLLBACK TO SAVEPOINT access_request_notify"))).toBe(true);
  });
});

describe("notifyAccessRequestDecision", () => {
  it("scopes an approval to the org and leaves a decline org-less so it is always visible", async () => {
    const { client, calls } = mockClient(() => []);
    await notifyAccessRequestDecision(client, {
      orgId: "org-1",
      requestId: "req-1",
      requesterUserId: "user-9",
      decision: "approved",
      teamNumber: 1234,
      grantedRole: "viewer",
    });
    await notifyAccessRequestDecision(client, {
      orgId: "org-1",
      requestId: "req-1",
      requesterUserId: "user-9",
      decision: "declined",
      teamNumber: 1234,
    });
    const inserts = calls.filter((call) => call.sql.includes("INSERT INTO notifications"));
    expect(inserts).toHaveLength(2);
    // [userId, orgId, type, payload]
    expect(inserts[0]?.params[1]).toBe("org-1");
    expect(inserts[0]?.params[2]).toBe("team_access_approved");
    expect(inserts[1]?.params[1]).toBeNull();
    expect(inserts[1]?.params[2]).toBe("team_access_declined");
  });
});

describe("owner password reset authorization", () => {
  const target = { userId: "member-1", email: "member@example.com", name: "Member", role: "scout" };

  function passwordResetClient(input: { actorRole: string | null; targetRow?: Row | null }) {
    return mockClient((sql) => {
      if (sql.includes("has_org_capability")) return [{ allowed: input.actorRole != null }];
      if (sql.includes("JOIN users")) return input.targetRow === null ? [] : [input.targetRow ?? target];
      if (sql.includes("SELECT role FROM memberships")) {
        return input.actorRole ? [{ role: input.actorRole }] : [];
      }
      return [];
    });
  }

  it("resolves the target for an owner without ever touching passwords", async () => {
    const { client } = passwordResetClient({ actorRole: "owner" });
    await expect(
      resolveMemberForPasswordReset(client, "actor-1", { orgId: "org-1", userId: "member-1" }),
    ).resolves.toEqual(target);
  });

  it("denies non-admin actors", async () => {
    const { client } = passwordResetClient({ actorRole: "scout" });
    await expect(
      resolveMemberForPasswordReset(client, "actor-1", { orgId: "org-1", userId: "member-1" }),
    ).rejects.toThrow("administrator access required");
  });

  it("blocks an admin from resetting an owner", async () => {
    const { client } = passwordResetClient({
      actorRole: "admin",
      targetRow: { ...target, role: "owner" },
    });
    await expect(
      resolveMemberForPasswordReset(client, "actor-1", { orgId: "org-1", userId: "member-1" }),
    ).rejects.toThrow("Only an owner");
  });

  it("rejects targets outside the workspace", async () => {
    const { client } = passwordResetClient({ actorRole: "owner", targetRow: null });
    await expect(
      resolveMemberForPasswordReset(client, "actor-1", { orgId: "org-1", userId: "stranger" }),
    ).rejects.toThrow("Member not found");
  });

  it("writes a traceable membership audit row", async () => {
    const { client, calls } = mockClient(() => []);
    await auditMemberPasswordReset(client, "actor-1", {
      orgId: "org-1",
      targetUserId: "member-1",
      email: "member@example.com",
      delivered: true,
    });
    const insert = calls.find((call) => call.sql.includes("membership_audit_events"));
    expect(insert).toBeDefined();
    expect(insert?.params[3]).toBe("member.password_reset.requested");
    expect(JSON.parse(String(insert?.params[5]))).toEqual({ targetUserId: "member-1", delivered: true });
  });
});
