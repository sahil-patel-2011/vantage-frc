import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { applyShopStepAction, cleanDrawingUrl, computeShopStepsView, SHOP_STEPS_MIGRATION_MESSAGE } from "./steps";
import { parseShopStepAction } from "./steps-input";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PART = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STEP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Handler = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number } | undefined;

function stubClient(supported: boolean, handler: Handler) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*(SAVEPOINT|RELEASE|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes("information_schema.columns")) return supported ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes("FROM memberships m") && sql.includes("ORDER BY CASE m.role")) return { rows: [{ orgId: ORG, role: "member" }], rowCount: 1 };
    return handler(sql, params) ?? { rows: [], rowCount: 0 };
  });
  return { client: { query } as unknown as PoolClient, query };
}

const ran = (query: ReturnType<typeof stubClient>["query"], pattern: RegExp) => query.mock.calls.filter(([sql]) => pattern.test(String(sql)));

describe("shop steps before the migration is applied", () => {
  it("answers a calm setup view, and refuses writes with the same sentence", async () => {
    const { client } = stubClient(false, () => undefined);
    expect(await computeShopStepsView(client, { userId: USER, requestedOrg: ORG, kiosk: true })).toEqual({
      status: "setup_required",
      reason: "migration",
      message: SHOP_STEPS_MIGRATION_MESSAGE,
      orgId: ORG,
    });
    await expect(applyShopStepAction(client, { orgId: ORG, userId: USER, change: { action: "delete-step", stepId: STEP } })).rejects.toThrow(SHOP_STEPS_MIGRATION_MESSAGE);
  });
});

describe("shop steps", () => {
  it("starting the first step puts a queued part on the machine, with a board history row", async () => {
    const { client, query } = stubClient(true, (sql) => {
      if (sql.includes("FROM manufacturing_steps WHERE id")) return { rows: [{ partId: PART, position: 0, status: "todo", title: "Mill pockets" }], rowCount: 1 };
      if (sql.includes("SELECT state, method FROM manufacturing_parts")) return { rows: [{ state: "ready_to_cut", method: "mill" }], rowCount: 1 };
      if (sql.includes("SELECT state FROM manufacturing_parts")) return { rows: [{ state: "ready_to_cut" }], rowCount: 1 };
      return undefined;
    });
    await applyShopStepAction(client, { orgId: ORG, userId: USER, change: { action: "start-step", stepId: STEP, workedBy: null } });
    expect(ran(query, /SET status = 'doing'/)[0]?.[1]).toEqual([STEP, ORG, USER, USER]);
    const event = ran(query, /INSERT INTO manufacturing_state_events/)[0];
    expect(event?.[1]).toEqual([ORG, PART, "ready_to_cut", "in_progress", "Started: Mill pockets", USER]);
  });

  it("finishing the last step marks the part done; an earlier step leaves it where it is", async () => {
    let left = 0;
    const { client, query } = stubClient(true, (sql) => {
      if (sql.includes("FROM manufacturing_steps WHERE id")) return { rows: [{ partId: PART, position: 2, status: "doing", title: "Deburr" }], rowCount: 1 };
      if (sql.includes("SELECT state, method FROM manufacturing_parts")) return { rows: [{ state: "in_progress", method: "mill" }], rowCount: 1 };
      if (sql.includes("SELECT state FROM manufacturing_parts")) return { rows: [{ state: "in_progress" }], rowCount: 1 };
      if (sql.includes("status <> 'done' LIMIT 1")) return { rows: Array(left).fill({}), rowCount: left };
      return undefined;
    });
    left = 1;
    await applyShopStepAction(client, { orgId: ORG, userId: USER, change: { action: "finish-step", stepId: STEP, workedBy: null } });
    expect(ran(query, /INSERT INTO manufacturing_state_events/)).toHaveLength(0);
    left = 0;
    await applyShopStepAction(client, { orgId: ORG, userId: USER, change: { action: "finish-step", stepId: STEP, workedBy: null } });
    expect(ran(query, /INSERT INTO manufacturing_state_events/)[0]?.[1]).toEqual([ORG, PART, "in_progress", "done", "All shop steps done", USER]);
  });

  it("finishing the only step of a queued part without Start puts it on the machine, then marks it done", async () => {
    const { client, query } = stubClient(true, (sql) => {
      if (sql.includes("FROM manufacturing_steps WHERE id")) return { rows: [{ partId: PART, position: 0, status: "todo", title: "Cut" }], rowCount: 1 };
      if (sql.includes("SELECT state, method FROM manufacturing_parts")) return { rows: [{ state: "ready_to_cut", method: "bandsaw" }], rowCount: 1 };
      if (sql.includes("SELECT state FROM manufacturing_parts")) {
        const moved = ran(query, /INSERT INTO manufacturing_state_events/).length;
        return { rows: [{ state: moved ? "in_progress" : "ready_to_cut" }], rowCount: 1 };
      }
      return undefined;
    });
    await applyShopStepAction(client, { orgId: ORG, userId: USER, change: { action: "finish-step", stepId: STEP, workedBy: null } });
    expect(ran(query, /INSERT INTO manufacturing_state_events/).map(([, params]) => (params as unknown[]).slice(2, 4))).toEqual([
      ["ready_to_cut", "in_progress"],
      ["in_progress", "done"],
    ]);
  });

  it("credits a kiosk worker only when they are on the team", async () => {
    const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const { client } = stubClient(true, (sql) => {
      if (sql.includes("FROM manufacturing_steps WHERE id")) return { rows: [{ partId: PART, position: 0, status: "todo", title: "Cut" }], rowCount: 1 };
      if (sql.includes("SELECT state, method FROM manufacturing_parts")) return { rows: [{ state: "needs_cam", method: "mill" }], rowCount: 1 };
      if (sql.includes("FROM memberships WHERE org_id")) return { rows: [], rowCount: 0 };
      return undefined;
    });
    await expect(applyShopStepAction(client, { orgId: ORG, userId: USER, change: { action: "start-step", stepId: STEP, workedBy: OTHER } })).rejects.toThrow("Pick someone on the team.");
  });

  it("a starter list goes only onto a part with no steps, numbered from zero", async () => {
    const { client, query } = stubClient(true, (sql) => {
      if (sql.includes("SELECT state, method FROM manufacturing_parts")) return { rows: [{ state: "ready_to_cut", method: "bandsaw" }], rowCount: 1 };
      if (sql.includes("count(*)::int AS count")) return { rows: [{ count: 0, next: 0 }], rowCount: 1 };
      return undefined;
    });
    await applyShopStepAction(client, { orgId: ORG, userId: USER, change: { action: "use-template", partId: PART } });
    const inserts = ran(query, /INSERT INTO manufacturing_steps/);
    expect(inserts.map(([, params]) => (params as unknown[])[2])).toEqual([0, 1]);
    expect((inserts[0]![1] as unknown[])[3]).toBe("Mark and cut to length");
  });
});

describe("shop step input", () => {
  it("accepts only http(s) drawing links", () => {
    expect(cleanDrawingUrl("https://cad.onshape.com/documents/abc")).toBe("https://cad.onshape.com/documents/abc");
    expect(cleanDrawingUrl("")).toBeNull();
    expect(() => cleanDrawingUrl("javascript:alert(1)")).toThrow();
    expect(() => cleanDrawingUrl("not a link")).toThrow();
  });

  it("trims and caps step text and refuses unknown actions", () => {
    expect(parseShopStepAction({ action: "add-step", partId: PART, title: "  Mill   pockets ", machine: " Mill " })).toEqual({
      action: "add-step",
      partId: PART,
      title: "Mill pockets",
      machine: "Mill",
      notes: null,
    });
    expect(() => parseShopStepAction({ action: "add-step", partId: PART, title: "  " })).toThrow(/Name the step/);
    expect(() => parseShopStepAction({ action: "move-step", stepId: STEP, direction: "sideways" })).toThrow();
    expect(() => parseShopStepAction({ action: "drop-table" })).toThrow("Unknown action.");
  });
});
