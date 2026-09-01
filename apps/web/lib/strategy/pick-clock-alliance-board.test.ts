import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { emptyAllianceBoardState, type AllianceBoardState } from "./pick-desk";
import {
  advanceAllianceCursor,
  applySlotToAllianceBoardState,
  allianceSlotField,
  mirrorPickToAllianceBoard,
} from "./pick-clock-alliance-board";

function board(overrides: Partial<AllianceBoardState> = {}): AllianceBoardState {
  return {
    ...emptyAllianceBoardState(["frc254", "frc118", "frc1678", "frc1323"]),
    ...overrides,
  };
}

function stubClient(respond: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const result = respond(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
  });
  return { client: { query } as unknown as PoolClient, query };
}

describe("allianceSlotField", () => {
  it("maps the three draft slots onto the desk jsonb keys", () => {
    expect(allianceSlotField("captain")).toBe("captainTeamKey");
    expect(allianceSlotField("first")).toBe("firstPickTeamKey");
    expect(allianceSlotField("second")).toBe("secondPickTeamKey");
  });
});

describe("advanceAllianceCursor", () => {
  it("walks captains then firsts then snakes seconds 8 → 1", () => {
    const empty = board();
    expect(advanceAllianceCursor({ ...empty, currentSeed: 1, currentSlot: "captain" })).toEqual({
      currentSeed: 2,
      currentSlot: "captain",
    });
    expect(advanceAllianceCursor({ ...empty, currentSeed: 8, currentSlot: "captain" })).toEqual({
      currentSeed: 1,
      currentSlot: "first",
    });
    expect(advanceAllianceCursor({ ...empty, currentSeed: 8, currentSlot: "first" })).toEqual({
      currentSeed: 8,
      currentSlot: "second",
    });
    expect(advanceAllianceCursor({ ...empty, currentSeed: 8, currentSlot: "second" })).toEqual({
      currentSeed: 7,
      currentSlot: "second",
    });
  });
});

describe("applySlotToAllianceBoardState", () => {
  it("records a captain and lifts them out of the available pool", () => {
    const next = applySlotToAllianceBoardState(board(), { allianceSeed: 1, pickSlot: "captain" }, "frc254");
    expect(next.alliances[0]?.captainTeamKey).toBe("frc254");
    expect(next.availableTeamKeys).not.toContain("frc254");
    expect(next.currentSeed).toBe(2);
    expect(next.currentSlot).toBe("captain");
  });

  it("clears a slot on undo and returns the team to the pool", () => {
    const filled = applySlotToAllianceBoardState(board(), { allianceSeed: 1, pickSlot: "captain" }, "frc254");
    const undone = applySlotToAllianceBoardState(filled, { allianceSeed: 1, pickSlot: "captain" }, null);
    expect(undone.alliances[0]?.captainTeamKey).toBeNull();
    expect(undone.availableTeamKeys).toContain("frc254");
    expect(undone.currentSeed).toBe(1);
    expect(undone.currentSlot).toBe("captain");
  });

  it("moves a team that already sat in another slot instead of duplicating it", () => {
    const first = applySlotToAllianceBoardState(board(), { allianceSeed: 2, pickSlot: "captain" }, "frc118");
    const moved = applySlotToAllianceBoardState(first, { allianceSeed: 1, pickSlot: "first" }, "frc118");
    expect(moved.alliances.find((row) => row.seed === 2)?.captainTeamKey).toBeNull();
    expect(moved.alliances.find((row) => row.seed === 1)?.firstPickTeamKey).toBe("frc118");
  });
});

describe("mirrorPickToAllianceBoard", () => {
  it("updates the event's existing Draft day row with the recorded slot", async () => {
    const existing = emptyAllianceBoardState(["frc254", "frc118"]);
    const { client, query } = stubClient((sql) => {
      if (sql.includes("FROM alliance_boards")) {
        return { rows: [{ id: "board-1", state: existing, pickListId: null }] };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return { rows: [{ teamKey: "frc254" }, { teamKey: "frc118" }] };
      }
      if (sql.includes("UPDATE alliance_boards")) {
        return { rows: [{ id: "board-1" }], rowCount: 1 };
      }
      return { rows: [] };
    });

    const result = await mirrorPickToAllianceBoard(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      pickListId: "list-1",
      slot: { allianceSeed: 1, pickSlot: "captain" },
      teamKey: "frc254",
    });

    expect(result).toEqual({ mirrored: true, boardId: "board-1" });
    const update = query.mock.calls.find((call) => String(call[0]).includes("UPDATE alliance_boards"));
    expect(update).toBeTruthy();
    const state = JSON.parse(String(update![1]![3])) as AllianceBoardState;
    expect(state.alliances[0]?.captainTeamKey).toBe("frc254");
    expect(state.pickListId).toBe("list-1");
    expect(update![1]).toEqual(["board-1", "org-1", "list-1", expect.any(String)]);
  });

  it("inserts Draft day when the event has no alliance board yet", async () => {
    const { client, query } = stubClient((sql) => {
      if (sql.includes("FROM alliance_boards")) return { rows: [] };
      if (sql.includes("FROM team_event_metrics")) return { rows: [{ teamKey: "frc254" }] };
      if (sql.includes("INSERT INTO alliance_boards")) {
        return { rows: [{ id: "board-new" }], rowCount: 1 };
      }
      return { rows: [] };
    });

    const result = await mirrorPickToAllianceBoard(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      pickListId: "list-1",
      slot: { allianceSeed: 1, pickSlot: "captain" },
      teamKey: "frc254",
    });

    expect(result.mirrored).toBe(true);
    expect(result.boardId).toBe("board-new");
    const insert = query.mock.calls.find((call) => String(call[0]).includes("INSERT INTO alliance_boards"));
    expect(insert?.[0]).toMatch(/ON CONFLICT \(org_id, event_key, name\)/);
    expect(insert?.[1]?.[2]).toBe("list-1");
  });

  it("returns mirrored false when RLS refuses the desk write", async () => {
    // 0505 does not grant scout. org_role is owner|admin|scout|viewer; a scout-role
    // captain still hits this catch until a captain-capable enum value exists.
    const { client } = stubClient(() => {
      throw new Error("permission denied for table alliance_boards");
    });

    const result = await mirrorPickToAllianceBoard(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      pickListId: "list-1",
      slot: { allianceSeed: 1, pickSlot: "captain" },
      teamKey: "frc254",
    });

    expect(result).toEqual({ mirrored: false, boardId: null });
  });
});
