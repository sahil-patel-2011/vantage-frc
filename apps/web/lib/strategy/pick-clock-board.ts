// Pick Clock writes to the ONE pick list.
//
// Pick Clock could recommend a pick but never record one: the recommendation lived and died in
// component state, so the 45 seconds after the choice were spent re-typing it into the draft
// board. This module lets the clock record and undo against the same pick_list_entries.drafted_*
// spine the alliance-selection desk projects (migration 0454), which is also the source of the
// `draftedTeamKeys` the clock already excludes. One board, one truth.
//
// The spine write goes through lib/picklist/store.ts, so RLS, rank renormalization and the
// one-team-per-slot partial unique index are enforced exactly once. The alliance_boards
// jsonb row is then mirrored so Draft day does not drift from the clock.

import type { PoolClient } from "@neondatabase/serverless";
import {
  ALLIANCE_SEEDS,
  DRAFT_PICK_SLOTS,
  boardState,
  ensurePickList,
  listPickLists,
  normalizeTeamKey,
  setBoardSlot,
  type BoardSlot,
  type BoardStateView,
  type DraftPickSlot,
} from "../picklist";
import { mirrorPickToAllianceBoard } from "./pick-clock-alliance-board";

export type BoardSlotRef = { allianceSeed: number; pickSlot: DraftPickSlot };

/**
 * The list the clock writes to.
 *
 * boardState() resolves the most recently touched list for the event, so the clock must resolve
 * the same way — going straight to ensurePickList() would mint a second list named "Pick list"
 * next to the one the desk is actually looking at, which is the exact split this spine removed.
 */
export async function resolveBoardPickListId(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; pickListId?: string | null },
): Promise<string> {
  if (input.pickListId) return input.pickListId;
  const [existing] = await listPickLists(client, {
    orgId: input.orgId,
    eventKey: input.eventKey,
  });
  if (existing) return existing.id;
  return ensurePickList(client, {
    orgId: input.orgId,
    userId: input.userId,
    eventKey: input.eventKey,
    source: "strategy",
  });
}

export type PickClockWriteResult = {
  status: "recorded" | "undone" | "noop" | "conflict";
  /** The slot that was written, or the occupied slot when status is "conflict". */
  slot: BoardSlotRef | null;
  teamKey: string | null;
  message: string;
  board: BoardStateView | null;
  /** False when alliance_boards RLS (owner/admin) refused the desk mirror. */
  allianceBoardMirrored: boolean;
};

/**
 * Draft order for a pick round: seeds 1..8 take their captain, then their first pick, then their
 * second. Pure so "where does this pick go" is testable without a database.
 */
export function nextOpenBoardSlot(board: BoardStateView | null): BoardSlotRef | null {
  if (!board) return null;
  for (const pickSlot of DRAFT_PICK_SLOTS) {
    // Second picks snake reverse — same order the draft desk advances.
    const seeds = pickSlot === "second" ? [...ALLIANCE_SEEDS].reverse() : ALLIANCE_SEEDS;
    for (const allianceSeed of seeds) {
      const slot = board.slots.find(
        (candidate) => candidate.allianceSeed === allianceSeed && candidate.pickSlot === pickSlot,
      );
      if (slot && !slot.teamKey) return { allianceSeed, pickSlot };
    }
  }
  return null;
}

/** The most recently drafted slot — what "undo" means when no slot is named. */
export function lastDraftedSlot(board: BoardStateView | null): BoardSlot | null {
  if (!board) return null;
  let latest: BoardSlot | null = null;
  for (const slot of board.slots) {
    if (!slot.teamKey || !slot.draftedAt) continue;
    if (!latest?.draftedAt || slot.draftedAt > latest.draftedAt) latest = slot;
  }
  return latest;
}

export function isValidBoardSlot(ref: {
  allianceSeed?: unknown;
  pickSlot?: unknown;
}): ref is BoardSlotRef {
  return (
    typeof ref.allianceSeed === "number" &&
    ALLIANCE_SEEDS.includes(ref.allianceSeed) &&
    typeof ref.pickSlot === "string" &&
    (DRAFT_PICK_SLOTS as string[]).includes(ref.pickSlot)
  );
}

function findSlot(board: BoardStateView, ref: BoardSlotRef): BoardSlot | null {
  return (
    board.slots.find(
      (slot) => slot.allianceSeed === ref.allianceSeed && slot.pickSlot === ref.pickSlot,
    ) ?? null
  );
}

function slotLabel(ref: BoardSlotRef): string {
  return `alliance ${ref.allianceSeed} ${ref.pickSlot}`;
}

/**
 * Record a pick from the clock.
 *
 * Idempotent: recording the same team into the same slot again is a no-op rather than a second
 * row. Concurrency-safe by default: if another device already put a DIFFERENT team in that slot,
 * this returns a `conflict` naming the occupant instead of silently overwriting Saturday's board.
 * Pass `force` when the operator resolves the conflict deliberately.
 */
export async function recordPickClockPick(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    teamKey: string | number;
    slot?: BoardSlotRef | null;
    rationale?: string | null;
    pickListId?: string | null;
    force?: boolean;
  },
): Promise<PickClockWriteResult> {
  const teamKey = normalizeTeamKey(input.teamKey);
  if (!teamKey) throw new Error("A valid team number is required to record a pick.");

  const pickListId = await resolveBoardPickListId(client, input);

  const before = await boardState(client, { orgId: input.orgId, pickListId });
  const slot = input.slot ?? nextOpenBoardSlot(before);
  if (!slot) {
    return {
      status: "noop",
      slot: null,
      teamKey,
      message: "Every alliance slot is filled — clear one on the pick desk before recording again.",
      board: before,
      allianceBoardMirrored: false,
    };
  }

  const occupant = before ? findSlot(before, slot) : null;
  if (occupant?.teamKey === teamKey) {
    return {
      status: "noop",
      slot,
      teamKey,
      message: `${teamKey.replace(/^frc/, "")} is already recorded at ${slotLabel(slot)}.`,
      board: before,
      allianceBoardMirrored: false,
    };
  }
  if (occupant?.teamKey && !input.force) {
    return {
      status: "conflict",
      slot,
      teamKey: occupant.teamKey,
      message: `${occupant.teamKey.replace(/^frc/, "")} was already recorded at ${slotLabel(
        slot,
      )} on another device. Refresh, or record over it deliberately.`,
      board: before,
      allianceBoardMirrored: false,
    };
  }

  await setBoardSlot(client, {
    orgId: input.orgId,
    userId: input.userId,
    pickListId,
    allianceSeed: slot.allianceSeed,
    pickSlot: slot.pickSlot,
    teamKey,
    rationale: input.rationale ?? null,
  });

  const mirror = await mirrorPickToAllianceBoard(client, {
    orgId: input.orgId,
    userId: input.userId,
    eventKey: input.eventKey,
    pickListId,
    slot,
    teamKey,
  });

  return {
    status: "recorded",
    slot,
    teamKey,
    message: `${teamKey.replace(/^frc/, "")} recorded at ${slotLabel(slot)}.`,
    board: await boardState(client, { orgId: input.orgId, pickListId }),
    allianceBoardMirrored: mirror.mirrored,
  };
}

/**
 * Undo a recorded pick. With no slot, undoes the most recently drafted one. Clearing an already
 * empty slot is a no-op, so a double-tap on Undo cannot walk backwards through the board.
 */
export async function undoPickClockPick(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    slot?: BoardSlotRef | null;
    pickListId?: string | null;
  },
): Promise<PickClockWriteResult> {
  const pickListId = await resolveBoardPickListId(client, input);

  const before = await boardState(client, { orgId: input.orgId, pickListId });
  const target = input.slot ?? lastDraftedSlot(before);
  if (!target) {
    return {
      status: "noop",
      slot: null,
      teamKey: null,
      message: "No recorded picks to undo.",
      board: before,
      allianceBoardMirrored: false,
    };
  }

  const ref: BoardSlotRef = { allianceSeed: target.allianceSeed, pickSlot: target.pickSlot };
  const occupant = before ? findSlot(before, ref) : null;
  if (!occupant?.teamKey) {
    return {
      status: "noop",
      slot: ref,
      teamKey: null,
      message: `${slotLabel(ref)} is already empty.`,
      board: before,
      allianceBoardMirrored: false,
    };
  }

  await setBoardSlot(client, {
    orgId: input.orgId,
    userId: input.userId,
    pickListId,
    allianceSeed: ref.allianceSeed,
    pickSlot: ref.pickSlot,
    teamKey: null,
  });

  const mirror = await mirrorPickToAllianceBoard(client, {
    orgId: input.orgId,
    userId: input.userId,
    eventKey: input.eventKey,
    pickListId,
    slot: ref,
    teamKey: null,
  });

  return {
    status: "undone",
    slot: ref,
    teamKey: occupant.teamKey,
    message: `${occupant.teamKey.replace(/^frc/, "")} removed from ${slotLabel(ref)} — it is back in the clock's pool.`,
    board: await boardState(client, { orgId: input.orgId, pickListId }),
    allianceBoardMirrored: mirror.mirrored,
  };
}
