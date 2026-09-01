import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  assignCoverageSlot,
  canWriteAssignments,
  computeScoutingCoverageView,
  planAutoAssignments,
  swapCoverageSlot,
} from "./coverage";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "11111111-1111-4111-8111-111111111111";
const SCOUT = "22222222-2222-4222-8222-222222222222";
const EVENT = "2026txho";

type Handler = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number };

function makeClient(handler: Handler): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const result = handler(sql, params);
      return { rowCount: result.rows.length, ...result };
    }),
  } as unknown as PoolClient;
}

const MATCH_ROWS = [
  {
    matchKey: `${EVENT}_qm1`,
    compLevel: "qm",
    matchNumber: 1,
    redAlliance: { teamKeys: ["frc254", "frc118"] },
    blueAlliance: { teamKeys: ["frc1323", "frc4414"] },
    eventTime: "2026-03-01T15:00:00.000Z",
  },
];

function liveHandler(overrides: Partial<Record<string, unknown[]>> = {}): Handler {
  return (sql) => {
    if (sql.includes("FROM memberships") && sql.includes("o.team_number")) {
      return { rows: [{ orgId: ORG, teamNumber: 1234, role: "admin" }] };
    }
    if (sql.includes("FROM org_active_context")) return { rows: [{ eventKey: EVENT }] };
    if (sql.includes("FROM matches_ref")) return { rows: overrides.matches ?? MATCH_ROWS };
    if (sql.includes("FROM scout_assignments") && sql.includes("GROUP BY")) {
      return { rows: overrides.assignments ?? [] };
    }
    if (sql.includes("FROM match_scout_entries")) return { rows: overrides.entries ?? [] };
    if (sql.includes("FROM memberships")) return { rows: overrides.scouts ?? [] };
    if (sql.includes("FROM scout_schemas")) return { rows: overrides.schemas ?? [] };
    return { rows: [] };
  };
}

describe("computeScoutingCoverageView", () => {
  it("returns setup_required with steps when the user has no org membership", async () => {
    const view = await computeScoutingCoverageView(
      makeClient(() => ({ rows: [] })),
      { userId: USER, requestedOrg: null },
    );

    expect(view.status).toBe("setup_required");
    if (view.status !== "setup_required") throw new Error("expected setup_required");
    expect(view.orgId).toBeNull();
    expect(view.steps.map((step) => step.id)).toContain("workspace");
  });

  it("hard-denies an explicit foreign orgId instead of falling back to another org", async () => {
    await expect(
      computeScoutingCoverageView(makeClient(() => ({ rows: [] })), {
        userId: USER,
        requestedOrg: OTHER_ORG,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns setup_required when the org has no active event", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 1234, role: "scout" }] };
      }
      return { rows: [] };
    });

    const view = await computeScoutingCoverageView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status !== "setup_required") throw new Error("expected setup_required");
    expect(view.orgId).toBe(ORG);
    expect(view.steps.map((step) => step.id)).toContain("active-event");
  });

  it("builds the lineup board from real schedule, assignment and entry rows", async () => {
    const client = makeClient(
      liveHandler({
        assignments: [{ matchKey: `${EVENT}_qm1`, teamKey: "frc118", count: 1 }],
        entries: [
          {
            matchKey: `${EVENT}_qm1`,
            teamKey: "frc254",
            scoutUserId: USER,
            scoutName: "Ada",
          },
          {
            matchKey: `${EVENT}_qm1`,
            teamKey: "frc1323",
            scoutUserId: USER,
            scoutName: "Ada",
          },
          {
            matchKey: `${EVENT}_qm1`,
            teamKey: "frc1323",
            scoutUserId: SCOUT,
            scoutName: "Grace",
          },
        ],
        scouts: [
          { userId: USER, name: "Ada", role: "admin", assignedCount: 0 },
          { userId: SCOUT, name: "Grace", role: "scout", assignedCount: 2 },
        ],
      }),
    );

    const view = await computeScoutingCoverageView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.eventKey).toBe(EVENT);
    expect(view.slots).toHaveLength(4);
    expect(view.summary.totalSlots).toBe(4);
    expect(view.summary.covered).toBe(1);
    expect(view.summary.doubleCovered).toBe(1);
    expect(view.summary.assignedWaiting).toBe(1);
    expect(view.summary.unscouted).toBe(1);
    expect(view.canAssign).toBe(true);
    expect(view.scouts.find((scout) => scout.isMe)?.userId).toBe(USER);
    // Attribution comes from membership ids joined to users.name, never a typed name.
    expect(view.slots.find((slot) => slot.teamKey === "frc1323")?.scoutNames).toEqual([
      "Ada",
      "Grace",
    ]);
    expect(view.live.gapSlots.map((slot) => slot.teamKey)).toEqual(["frc118", "frc4414"]);
  });

  it("reports canAssign false for a scout, whose role cannot write scout_assignments", async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM memberships") && sql.includes("o.team_number")) {
        return { rows: [{ orgId: ORG, teamNumber: 1234, role: "scout" }] };
      }
      return liveHandler()(sql, params);
    });

    const view = await computeScoutingCoverageView(client, { userId: USER, requestedOrg: ORG });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.canAssign).toBe(false);
  });

  it("surfaces blocking schema-role warnings alongside the board", async () => {
    const client = makeClient(
      liveHandler({
        schemas: [
          {
            type: "match",
            schema: {
              title: "Custom match",
              fields: [
                { key: "how_many_things", label: "How many things", type: "number" },
                { key: "notes", label: "Notes", type: "text" },
              ],
            },
          },
        ],
      }),
    );

    const view = await computeScoutingCoverageView(client, { userId: USER, requestedOrg: ORG });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.schemaRoles.status).toBe("warnings");
    expect(view.schemaRoles.missingRoles).toContain("teleop_score");
    expect(view.schemaRoles.warnings.some((warning) => warning.severity === "blocking")).toBe(true);
  });

  it("returns an empty board without querying assignments when no schedule is synced", async () => {
    const client = makeClient(liveHandler({ matches: [] }));

    const view = await computeScoutingCoverageView(client, { userId: USER, requestedOrg: ORG });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.slots).toEqual([]);
    expect(view.summary.totalSlots).toBe(0);
    expect(view.summary.coverageRate).toBeNull();
  });

  it("orders a watchlisted team earlier than schedule order", async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM opponent_watchlist_entries")) {
        return { rows: [{ teamKey: "frc4414" }] };
      }
      return liveHandler()(sql, params);
    });

    const view = await computeScoutingCoverageView(client, { userId: USER, requestedOrg: ORG });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.slots.map((slot) => slot.teamKey)[0]).toBe("frc4414");
    expect(view.slots.map((slot) => slot.teamKey)).toContain("frc118");
  });

  it("accepts an explicit priorityTeamKeys override without querying watchlist rows", async () => {
    const seen: string[] = [];
    const client = makeClient((sql, params) => {
      seen.push(sql);
      return liveHandler()(sql, params);
    });

    const view = await computeScoutingCoverageView(client, {
      userId: USER,
      requestedOrg: ORG,
      priorityTeamKeys: ["frc1323"],
    });
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.slots[0]?.teamKey).toBe("frc1323");
    expect(seen.some((sql) => sql.includes("FROM opponent_watchlist_entries"))).toBe(false);
  });
});

describe("planAutoAssignments", () => {
  const slots = [
    { matchKey: "m2", teamKey: "frc2", status: "unscouted" as const, assignmentCount: 0, matchNumber: 2, compLevel: "qm" },
    { matchKey: "m1", teamKey: "frc1", status: "unscouted" as const, assignmentCount: 0, matchNumber: 1, compLevel: "qm" },
    { matchKey: "m1", teamKey: "frc3", status: "assigned" as const, assignmentCount: 1, matchNumber: 1, compLevel: "qm" },
    { matchKey: "m1", teamKey: "frc4", status: "covered" as const, assignmentCount: 0, matchNumber: 1, compLevel: "qm" },
  ];

  it("only fills unscouted, unassigned slots in schedule order", () => {
    const plan = planAutoAssignments({
      slots,
      scouts: [{ userId: "a", assignedCount: 0 }],
    });
    expect(plan).toEqual([
      { matchKey: "m1", teamKey: "frc1", userId: "a" },
      { matchKey: "m2", teamKey: "frc2", userId: "a" },
    ]);
  });

  it("starts from existing load so the lightest-loaded scout goes first", () => {
    const plan = planAutoAssignments({
      slots,
      scouts: [
        { userId: "busy", assignedCount: 5 },
        { userId: "free", assignedCount: 0 },
      ],
    });
    expect(plan.map((entry) => entry.userId)).toEqual(["free", "free"]);
  });

  it("plans nothing when there are no eligible members or no gaps", () => {
    expect(planAutoAssignments({ slots, scouts: [] })).toEqual([]);
    expect(
      planAutoAssignments({
        slots: slots.filter((slot) => slot.status !== "unscouted"),
        scouts: [{ userId: "a", assignedCount: 0 }],
      }),
    ).toEqual([]);
  });

  it("honors an explicit limit", () => {
    const plan = planAutoAssignments({
      slots,
      scouts: [{ userId: "a", assignedCount: 0 }],
      limit: 1,
    });
    expect(plan).toHaveLength(1);
  });

  it("assigns a watchlisted team earlier than later-schedule gaps", () => {
    const plan = planAutoAssignments({
      slots,
      scouts: [{ userId: "a", assignedCount: 0 }],
      priorityTeamKeys: ["frc2"],
    });
    expect(plan.map((entry) => entry.teamKey)).toEqual(["frc2", "frc1"]);
  });
});

describe("coverage assignment writes", () => {
  it("assign is idempotent through the table's own unique constraint", async () => {
    const seen: string[] = [];
    const client = makeClient((sql) => {
      seen.push(sql);
      return { rows: [], rowCount: 0 };
    });

    const result = await assignCoverageSlot(client, {
      orgId: ORG,
      eventKey: EVENT,
      matchKey: `${EVENT}_qm1`,
      teamKey: "frc254",
      userId: SCOUT,
    });

    expect(result.inserted).toBe(false);
    expect(seen[0]).toContain("ON CONFLICT (org_id, user_id, match_key, team_key) DO NOTHING");
  });

  it("swap refuses a no-op self swap and reports when another device already moved the row", async () => {
    const client = makeClient(() => ({ rows: [], rowCount: 0 }));

    expect(
      await swapCoverageSlot(client, {
        orgId: ORG,
        matchKey: "m1",
        teamKey: "frc1",
        fromUserId: USER,
        toUserId: USER,
      }),
    ).toEqual({ moved: false });

    expect(
      await swapCoverageSlot(client, {
        orgId: ORG,
        matchKey: "m1",
        teamKey: "frc1",
        fromUserId: USER,
        toUserId: SCOUT,
      }),
    ).toEqual({ moved: false });
  });
});

describe("canWriteAssignments", () => {
  it("matches the scout_assignments RLS policy (owner/admin only)", () => {
    expect(canWriteAssignments("owner")).toBe(true);
    expect(canWriteAssignments("admin")).toBe(true);
    expect(canWriteAssignments("scout")).toBe(false);
    expect(canWriteAssignments(null)).toBe(false);
  });
});
