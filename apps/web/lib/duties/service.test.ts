import { describe, expect, it } from "vitest";
import { assignWatch, computeDutiesView, deleteWatch, updateWatch } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const VIEWER = "33333333-3333-4333-8333-333333333333";
const ASSIGNEE = "44444444-4444-4444-8444-444444444444";
const DUTY = "55555555-5555-4555-8555-555555555555";

type Call = { sql: string; params: unknown[] };

function mockClient(options: {
  role?: string | null;
  assigneeOk?: boolean;
  columns?: string[];
  watches?: Array<Record<string, unknown>>;
  members?: Array<{ userId: string; name: string | null; email: string | null }>;
  roster?: Array<Record<string, unknown>>;
  insertId?: string;
  updateCount?: number;
  deleteCount?: number;
}) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM memberships") && sql.includes("user_id = $2") && !sql.includes("JOIN users")) {
        if (sql.includes("SELECT 1")) {
          return options.assigneeOk === false ? { rows: [], rowCount: 0 } : { rows: [{}], rowCount: 1 };
        }
        const role = options.role;
        return role
          ? { rows: [{ role }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("information_schema.columns")) {
        const cols = (options.columns ?? ["phone", "location_note"]).map((column_name) => ({ column_name }));
        return { rows: cols, rowCount: cols.length };
      }
      if (sql.includes("INSERT INTO duty_assignments")) {
        return { rows: [{ id: options.insertId ?? DUTY }], rowCount: 1 };
      }
      if (sql.includes("UPDATE duty_assignments")) {
        return { rows: [], rowCount: options.updateCount ?? 1 };
      }
      if (sql.includes("DELETE FROM duty_assignments")) {
        return { rows: [], rowCount: options.deleteCount ?? 1 };
      }
      if (sql.includes("JOIN organizations")) {
        return {
          rows: [
            { orgId: ORG, role: options.role ?? "admin", orgName: "Team", teamNumber: 254 },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM duty_assignments") && sql.includes("team_subteams")) {
        return { rows: options.roster ?? [], rowCount: (options.roster ?? []).length };
      }
      if (sql.includes("SELECT id::text AS id FROM duty_assignments")) {
        return { rows: [{ id: DUTY }], rowCount: 1 };
      }
      if (sql.includes("FROM duty_assignments") && sql.includes("kind = ANY")) {
        return { rows: options.watches ?? [], rowCount: (options.watches ?? []).length };
      }
      if (sql.includes("JOIN users u ON u.id = m.user_id")) {
        return { rows: options.members ?? [], rowCount: (options.members ?? []).length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
  return { client, calls };
}

describe("assignWatch", () => {
  it("refuses a viewer so a student cannot post themselves as the adult", async () => {
    const { client } = mockClient({ role: "viewer" });
    await expect(
      assignWatch(client, {
        action: "assign_watch",
        orgId: ORG,
        kind: "on_duty",
        title: "On duty",
        assignedUserId: ASSIGNEE,
        startsAt: "2026-03-07T14:00:00.000Z",
        endsAt: null,
        phone: "",
        locationNote: "",
        notes: "",
        userId: VIEWER,
      }),
    ).rejects.toThrow(/owner or admin/);
  });

  it("inserts an assigned on-duty row scoped to the org", async () => {
    const { client, calls } = mockClient({ role: "admin", insertId: DUTY });
    const id = await assignWatch(client, {
      action: "assign_watch",
      orgId: ORG,
      kind: "on_duty",
      title: "On duty",
      assignedUserId: ASSIGNEE,
      startsAt: "2026-03-07T14:00:00.000Z",
      endsAt: "2026-03-07T22:00:00.000Z",
      phone: "555-0100",
      locationNote: "Pit",
      notes: "",
      userId: ADMIN,
    });
    expect(id).toBe(DUTY);
    const insert = calls.find((call) => call.sql.includes("INSERT INTO duty_assignments"));
    expect(insert?.params[0]).toBe(ORG);
    expect(insert?.params[2]).toBe("on_duty");
    expect(insert?.params[5]).toBe(ASSIGNEE);
    expect(insert?.sql).toMatch(/\$1::uuid/);
  });
});

describe("updateWatch + deleteWatch", () => {
  it("unassigns without deleting the slot", async () => {
    const { client, calls } = mockClient({ role: "owner" });
    await updateWatch(client, {
      action: "update_watch",
      orgId: ORG,
      id: DUTY,
      assignedUserId: null,
      userId: ADMIN,
    });
    const update = calls.find((call) => call.sql.includes("UPDATE duty_assignments"));
    expect(update?.params[0]).toBe(DUTY);
    expect(update?.params[1]).toBe(ORG);
    expect(update?.params[7]).toBe(true);
    expect(update?.params[8]).toBeNull();
  });

  it("deletes only an on-duty / chaperone row for that org", async () => {
    const { client, calls } = mockClient({ role: "admin" });
    await deleteWatch(client, { orgId: ORG, id: DUTY, userId: ADMIN });
    const del = calls.find((call) => call.sql.includes("DELETE FROM duty_assignments"));
    expect(del?.params).toEqual([DUTY, ORG, ["on_duty", "chaperone"]]);
  });
});

describe("computeDutiesView", () => {
  it("stays empty until a watch is assigned", async () => {
    const { client } = mockClient({
      role: "admin",
      watches: [
        {
          id: DUTY,
          kind: "on_duty",
          title: "On duty",
          assignedUserId: null,
          assignedUserName: null,
          phone: "",
          startsAt: "2026-03-07T14:00:00.000Z",
          endsAt: null,
          locationNote: "",
          notes: "",
        },
      ],
    });
    const view = await computeDutiesView(client, {
      userId: ADMIN,
      requestedOrg: ORG,
      now: new Date("2026-03-07T16:00:00.000Z"),
    });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.watches).toHaveLength(1);
    expect(view.activeWatch).toBeNull();
    expect(view.myDayCue).toBeNull();
    expect(view.canManage).toBe(true);
  });

  it("exposes the assigned cue My Day can import", async () => {
    const { client } = mockClient({
      role: "scout",
      watches: [
        {
          id: DUTY,
          kind: "chaperone",
          title: "Chaperone",
          assignedUserId: ASSIGNEE,
          assignedUserName: "Pat",
          phone: "555-0199",
          startsAt: "2026-03-07T14:00:00.000Z",
          endsAt: "2026-03-07T22:00:00.000Z",
          locationNote: "Hotel",
          notes: "",
        },
      ],
    });
    const view = await computeDutiesView(client, {
      userId: VIEWER,
      requestedOrg: ORG,
      now: new Date("2026-03-07T16:00:00.000Z"),
    });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.canManage).toBe(false);
    expect(view.activeWatch?.assignedUserName).toBe("Pat");
    expect(view.myDayCue).toMatchObject({
      mentorUserId: ASSIGNEE,
      mentorName: "Pat",
      kind: "chaperone",
      tripId: null,
    });
  });
});
