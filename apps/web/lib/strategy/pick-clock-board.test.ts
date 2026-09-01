import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardSlot, BoardStateView, DraftPickSlot } from "../picklist";
import {
  isValidBoardSlot,
  lastDraftedSlot,
  nextOpenBoardSlot,
  recordPickClockPick,
  undoPickClockPick,
} from "./pick-clock-board";

const setBoardSlotMock = vi.fn(async () => undefined);
const boardStateMock = vi.fn<() => Promise<BoardStateView | null>>();
const listPickListsMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const mirrorMock = vi.fn(async () => ({ mirrored: true, boardId: "board-1" }));

vi.mock("../picklist", async () => {
  const actual = await vi.importActual<typeof import("../picklist")>("../picklist");
  return {
    ...actual,
    listPickLists: () => listPickListsMock(),
    ensurePickList: vi.fn(async () => "created-list"),
    boardState: () => boardStateMock(),
    setBoardSlot: (...args: unknown[]) => setBoardSlotMock(...(args as [])),
  };
});

vi.mock("./pick-clock-alliance-board", () => ({
  mirrorPickToAllianceBoard: (...args: unknown[]) => mirrorMock(...(args as [])),
}));

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const SLOTS: DraftPickSlot[] = ["captain", "first", "second"];

function emptyBoard(
  filled: Array<{ allianceSeed: number; pickSlot: DraftPickSlot; teamKey: string; draftedAt: string }> = [],
): BoardStateView {
  const slots: BoardSlot[] = [];
  for (const allianceSeed of SEEDS) {
    for (const pickSlot of SLOTS) {
      const hit = filled.find(
        (entry) => entry.allianceSeed === allianceSeed && entry.pickSlot === pickSlot,
      );
      slots.push({
        allianceSeed,
        pickSlot,
        entryId: hit ? `entry-${hit.teamKey}` : null,
        teamKey: hit?.teamKey ?? null,
        teamNumber: hit ? Number(hit.teamKey.replace(/^frc/, "")) : null,
        nickname: null,
        rank: null,
        bucket: null,
        rationale: "",
        justification: null,
        draftedAt: hit?.draftedAt ?? null,
      });
    }
  }
  return {
    pickListId: "list-1",
    eventKey: "2026onto",
    slots,
    draftedTeamKeys: filled.map((entry) => entry.teamKey),
    updatedAt: "2026-03-14T12:00:00.000Z",
  };
}

const client = {} as never;
const base = { orgId: "org-1", userId: "user-1", eventKey: "2026onto", pickListId: "list-1" };

beforeEach(() => {
  setBoardSlotMock.mockClear();
  boardStateMock.mockReset();
  listPickListsMock.mockReset();
  listPickListsMock.mockResolvedValue([]);
  mirrorMock.mockClear();
  mirrorMock.mockResolvedValue({ mirrored: true, boardId: "board-1" });
});

describe("nextOpenBoardSlot", () => {
  it("fills every captain before any first pick", () => {
    expect(nextOpenBoardSlot(emptyBoard())).toEqual({ allianceSeed: 1, pickSlot: "captain" });
    const captains = SEEDS.map((seed) => ({
      allianceSeed: seed,
      pickSlot: "captain" as DraftPickSlot,
      teamKey: `frc${seed}`,
      draftedAt: `2026-03-14T12:0${seed}:00.000Z`,
    }));
    expect(nextOpenBoardSlot(emptyBoard(captains))).toEqual({
      allianceSeed: 1,
      pickSlot: "first",
    });
  });

  it("returns null without a board and when the board is full", () => {
    expect(nextOpenBoardSlot(null)).toBeNull();
    const all = SEEDS.flatMap((seed) =>
      SLOTS.map((pickSlot) => ({
        allianceSeed: seed,
        pickSlot,
        teamKey: `frc${seed}${pickSlot.length}`,
        draftedAt: "2026-03-14T12:00:00.000Z",
      })),
    );
    expect(nextOpenBoardSlot(emptyBoard(all))).toBeNull();
  });

  it("snakes second picks 8 → 1, matching the draft desk", () => {
    const captainsAndFirsts = SEEDS.flatMap((seed) =>
      (["captain", "first"] as DraftPickSlot[]).map((pickSlot) => ({
        allianceSeed: seed,
        pickSlot,
        teamKey: `frc${seed}${pickSlot === "captain" ? 1 : 2}`,
        draftedAt: "2026-03-14T12:00:00.000Z",
      })),
    );
    expect(nextOpenBoardSlot(emptyBoard(captainsAndFirsts))).toEqual({
      allianceSeed: 8,
      pickSlot: "second",
    });
  });
});

describe("lastDraftedSlot", () => {
  it("picks the newest drafted stamp, not board order", () => {
    const board = emptyBoard([
      { allianceSeed: 1, pickSlot: "captain", teamKey: "frc254", draftedAt: "2026-03-14T12:00:00Z" },
      { allianceSeed: 3, pickSlot: "captain", teamKey: "frc118", draftedAt: "2026-03-14T12:09:00Z" },
      { allianceSeed: 2, pickSlot: "captain", teamKey: "frc1678", draftedAt: "2026-03-14T12:04:00Z" },
    ]);
    expect(lastDraftedSlot(board)?.teamKey).toBe("frc118");
  });

  it("is null on an untouched board", () => {
    expect(lastDraftedSlot(emptyBoard())).toBeNull();
    expect(lastDraftedSlot(null)).toBeNull();
  });
});

describe("isValidBoardSlot", () => {
  it("accepts real slots and rejects everything else", () => {
    expect(isValidBoardSlot({ allianceSeed: 4, pickSlot: "second" })).toBe(true);
    expect(isValidBoardSlot({ allianceSeed: 9, pickSlot: "second" })).toBe(false);
    expect(isValidBoardSlot({ allianceSeed: 1, pickSlot: "third" })).toBe(false);
    expect(isValidBoardSlot({ allianceSeed: "1", pickSlot: "captain" })).toBe(false);
    expect(isValidBoardSlot({})).toBe(false);
  });
});

describe("recordPickClockPick", () => {
  it("writes the recommendation into the next open slot", async () => {
    boardStateMock.mockResolvedValue(emptyBoard());
    const result = await recordPickClockPick(client, { ...base, teamKey: "254" });
    expect(result.status).toBe("recorded");
    expect(result.slot).toEqual({ allianceSeed: 1, pickSlot: "captain" });
    expect(setBoardSlotMock).toHaveBeenCalledTimes(1);
    expect(setBoardSlotMock.mock.calls[0]![1]).toMatchObject({
      allianceSeed: 1,
      pickSlot: "captain",
      teamKey: "frc254",
    });
    expect(mirrorMock).toHaveBeenCalledTimes(1);
    expect(mirrorMock.mock.calls[0]![1]).toMatchObject({
      pickListId: "list-1",
      slot: { allianceSeed: 1, pickSlot: "captain" },
      teamKey: "frc254",
    });
    expect(result.allianceBoardMirrored).toBe(true);
  });

  it("is idempotent when the same team is already in that slot", async () => {
    boardStateMock.mockResolvedValue(
      emptyBoard([
        {
          allianceSeed: 1,
          pickSlot: "captain",
          teamKey: "frc254",
          draftedAt: "2026-03-14T12:00:00Z",
        },
      ]),
    );
    const result = await recordPickClockPick(client, {
      ...base,
      teamKey: "frc254",
      slot: { allianceSeed: 1, pickSlot: "captain" },
    });
    expect(result.status).toBe("noop");
    expect(setBoardSlotMock).not.toHaveBeenCalled();
    expect(mirrorMock).not.toHaveBeenCalled();
  });

  it("reports a conflict instead of overwriting another device's pick", async () => {
    boardStateMock.mockResolvedValue(
      emptyBoard([
        {
          allianceSeed: 1,
          pickSlot: "captain",
          teamKey: "frc118",
          draftedAt: "2026-03-14T12:00:00Z",
        },
      ]),
    );
    const result = await recordPickClockPick(client, {
      ...base,
      teamKey: "254",
      slot: { allianceSeed: 1, pickSlot: "captain" },
    });
    expect(result.status).toBe("conflict");
    expect(result.teamKey).toBe("frc118");
    expect(result.message).toMatch(/another device/i);
    expect(setBoardSlotMock).not.toHaveBeenCalled();
    expect(mirrorMock).not.toHaveBeenCalled();
  });

  it("overwrites only when the operator forces it", async () => {
    boardStateMock.mockResolvedValue(
      emptyBoard([
        {
          allianceSeed: 1,
          pickSlot: "captain",
          teamKey: "frc118",
          draftedAt: "2026-03-14T12:00:00Z",
        },
      ]),
    );
    const result = await recordPickClockPick(client, {
      ...base,
      teamKey: "254",
      slot: { allianceSeed: 1, pickSlot: "captain" },
      force: true,
    });
    expect(result.status).toBe("recorded");
    expect(setBoardSlotMock).toHaveBeenCalledTimes(1);
  });

  it("records onto the event's existing list instead of minting a parallel one", async () => {
    listPickListsMock.mockResolvedValue([{ id: "desk-list" }]);
    boardStateMock.mockResolvedValue(emptyBoard());
    await recordPickClockPick(client, {
      orgId: "org-1",
      userId: "user-1",
      eventKey: "2026onto",
      teamKey: "254",
    });
    expect(setBoardSlotMock.mock.calls[0]![1]).toMatchObject({ pickListId: "desk-list" });
  });

  it("still records when the alliance_boards mirror is refused", async () => {
    mirrorMock.mockResolvedValue({ mirrored: false, boardId: null });
    boardStateMock.mockResolvedValue(emptyBoard());
    const result = await recordPickClockPick(client, { ...base, teamKey: "254" });
    expect(result.status).toBe("recorded");
    expect(result.allianceBoardMirrored).toBe(false);
    expect(setBoardSlotMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a malformed team instead of writing a blank slot", async () => {
    boardStateMock.mockResolvedValue(emptyBoard());
    await expect(
      recordPickClockPick(client, { ...base, teamKey: "not-a-team" }),
    ).rejects.toThrow(/valid team number/i);
    expect(setBoardSlotMock).not.toHaveBeenCalled();
  });
});

describe("undoPickClockPick", () => {
  it("clears the most recent pick when no slot is named", async () => {
    boardStateMock.mockResolvedValue(
      emptyBoard([
        {
          allianceSeed: 1,
          pickSlot: "captain",
          teamKey: "frc254",
          draftedAt: "2026-03-14T12:00:00Z",
        },
        {
          allianceSeed: 2,
          pickSlot: "captain",
          teamKey: "frc118",
          draftedAt: "2026-03-14T12:07:00Z",
        },
      ]),
    );
    const result = await undoPickClockPick(client, base);
    expect(result.status).toBe("undone");
    expect(result.teamKey).toBe("frc118");
    expect(setBoardSlotMock.mock.calls[0]![1]).toMatchObject({
      allianceSeed: 2,
      pickSlot: "captain",
      teamKey: null,
    });
    expect(mirrorMock).toHaveBeenCalledTimes(1);
    expect(mirrorMock.mock.calls[0]![1]).toMatchObject({
      slot: { allianceSeed: 2, pickSlot: "captain" },
      teamKey: null,
    });
    expect(result.allianceBoardMirrored).toBe(true);
  });

  it("does nothing on an empty board, so a double tap cannot walk backwards", async () => {
    boardStateMock.mockResolvedValue(emptyBoard());
    const result = await undoPickClockPick(client, base);
    expect(result.status).toBe("noop");
    expect(setBoardSlotMock).not.toHaveBeenCalled();
  });

  it("no-ops on an already empty named slot", async () => {
    boardStateMock.mockResolvedValue(
      emptyBoard([
        {
          allianceSeed: 1,
          pickSlot: "captain",
          teamKey: "frc254",
          draftedAt: "2026-03-14T12:00:00Z",
        },
      ]),
    );
    const result = await undoPickClockPick(client, {
      ...base,
      slot: { allianceSeed: 5, pickSlot: "second" },
    });
    expect(result.status).toBe("noop");
    expect(setBoardSlotMock).not.toHaveBeenCalled();
  });
});
