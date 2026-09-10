import { describe, expect, it } from "vitest";
import { detectConflicts, groupBlocksByHour, summarizeEventDayPlan } from "./index";
import { computeEventDayPlanView } from "./compute-event-day-plan";
import type { EventDayPlanBlock } from "./types";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type QueryCall = { text: string; params: unknown[] };

function makeMockClient(rows: {
  membership?: Array<{ orgId: string; teamNumber: number | null }>;
  eventKeys?: Array<{ eventKey: string }>;
  blocks?: unknown[];
}) {
  const calls: QueryCall[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (text.includes("FROM memberships")) {
        return { rows: rows.membership ?? [], rowCount: (rows.membership ?? []).length };
      }
      if (text.includes("SELECT DISTINCT event_key")) {
        return { rows: rows.eventKeys ?? [], rowCount: (rows.eventKeys ?? []).length };
      }
      if (text.includes("FROM event_day_plan_blocks")) {
        return { rows: rows.blocks ?? [], rowCount: (rows.blocks ?? []).length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

function block(overrides: Partial<EventDayPlanBlock> = {}): EventDayPlanBlock {
  return {
    id: "b1",
    eventKey: "2026casj",
    planDate: "2026-03-14",
    kind: "scout_shift",
    title: "Red zone scouting",
    startAt: "2026-03-14T14:00:00.000Z",
    endAt: "2026-03-14T15:00:00.000Z",
    assignedTo: "Alex",
    location: "Field",
    notes: null,
    status: "planned",
    ...overrides,
  };
}

describe("computeEventDayPlanView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeMockClient({ membership: [] });
    const view = await computeEventDayPlanView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.message).toMatch(/Choose your team/);
    }
  });

  it("returns setup_required when the org has no logged blocks yet", async () => {
    const { client } = makeMockClient({
      membership: [{ orgId: ORG, teamNumber: 254 }],
      eventKeys: [],
    });
    const view = await computeEventDayPlanView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.eventKey).toBeNull();
    }
  });

  it("builds a live summary with hourly overlay and conflict detection over real rows", async () => {
    const { client } = makeMockClient({
      membership: [{ orgId: ORG, teamNumber: 254 }],
      eventKeys: [{ eventKey: "2026casj" }],
      blocks: [
        {
          id: "b1",
          eventKey: "2026casj",
          planDate: "2026-03-14",
          kind: "scout_shift",
          title: "Red zone scouting",
          startAt: "2026-03-14T14:00:00.000Z",
          endAt: "2026-03-14T15:00:00.000Z",
          assignedTo: "Alex",
          location: "Field",
          notes: null,
          status: "planned",
        },
        {
          id: "b2",
          eventKey: "2026casj",
          planDate: "2026-03-14",
          kind: "pit_repair",
          title: "Drivetrain check",
          startAt: "2026-03-14T14:30:00.000Z",
          endAt: "2026-03-14T15:30:00.000Z",
          assignedTo: "Alex",
          location: "Pit",
          notes: null,
          status: "planned",
        },
      ],
    });

    const view = await computeEventDayPlanView(client, {
      userId: USER,
      requestedOrg: ORG,
      eventKey: "2026casj",
      planDate: "2026-03-14",
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.blocks.length).toBe(2);
    expect(view.summary.totalBlocks).toBe(2);
    expect(view.summary.conflictCount).toBe(1);
    expect(view.conflicts[0].reason).toBe("assignee_overlap");
    expect(view.hourly.length).toBeGreaterThan(0);
  });
});

describe("detectConflicts", () => {
  it("flags overlapping blocks with the same assignee", () => {
    const a = block({ id: "a", assignedTo: "Jamie" });
    const b = block({
      id: "b",
      assignedTo: "Jamie",
      startAt: "2026-03-14T14:30:00.000Z",
      endAt: "2026-03-14T15:30:00.000Z",
      location: "Elsewhere",
    });
    const conflicts = detectConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe("assignee_overlap");
  });

  it("does not flag non-overlapping or cancelled blocks", () => {
    const a = block({ id: "a", assignedTo: "Jamie" });
    const b = block({
      id: "b",
      assignedTo: "Jamie",
      startAt: "2026-03-14T15:00:00.000Z",
      endAt: "2026-03-14T16:00:00.000Z",
    });
    expect(detectConflicts([a, b])).toHaveLength(0);

    const c = block({ id: "c", assignedTo: "Jamie" });
    const d = block({
      id: "d",
      assignedTo: "Jamie",
      startAt: "2026-03-14T14:30:00.000Z",
      endAt: "2026-03-14T15:30:00.000Z",
      status: "cancelled",
    });
    expect(detectConflicts([c, d])).toHaveLength(0);
  });
});

describe("groupBlocksByHour and summarizeEventDayPlan", () => {
  it("buckets blocks into the hours they touch and rolls up by kind", () => {
    const blocks = [
      block({ id: "a", kind: "scout_shift" }),
      block({ id: "b", kind: "pit_repair", assignedTo: null, location: null }),
    ];
    const hourly = groupBlocksByHour(blocks);
    expect(hourly.length).toBeGreaterThan(0);
    const summary = summarizeEventDayPlan(blocks, detectConflicts(blocks));
    expect(summary.totalBlocks).toBe(2);
    expect(summary.unassignedCount).toBe(1);
    expect(summary.byKind.find((k) => k.kind === "scout_shift")?.count).toBe(1);
  });
});
