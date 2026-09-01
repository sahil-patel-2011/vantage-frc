// Mirror a Pick Clock record/undo onto the draft-day alliance_boards jsonb.
//
// pick_list_entries.drafted_* is the ONE spine (migration 0454). Strategy / Draft still reads
// alliance_boards.state, so a captain recording from the clock would otherwise leave the desk
// looking at Saturday morning. This writes the same slot the desk persist() writes — same
// (org, event, "Draft day") row, same AllianceBoardState shape — without inventing teams.

import type { PoolClient } from "@neondatabase/serverless";
import {
  normalizeAllianceBoardState,
  type AllianceBoardState,
  type AllianceSlot,
} from "./pick-desk";
import type { DraftPickSlot } from "../picklist";

export type AllianceBoardSlotRef = { allianceSeed: number; pickSlot: DraftPickSlot };

const SLOT_FIELD: Record<DraftPickSlot, keyof Omit<AllianceSlot, "seed">> = {
  captain: "captainTeamKey",
  first: "firstPickTeamKey",
  second: "secondPickTeamKey",
};

export function allianceSlotField(pickSlot: DraftPickSlot): keyof Omit<AllianceSlot, "seed"> {
  return SLOT_FIELD[pickSlot];
}

/**
 * Advance the draft cursor the way `/strategy/draft` does: captains 1→8, firsts 1→8, then
 * second picks snake 8→1. Pure so record and undo stay testable without a database.
 */
export function advanceAllianceCursor(
  state: AllianceBoardState,
): Pick<AllianceBoardState, "currentSeed" | "currentSlot"> {
  const { currentSeed, currentSlot, alliances } = state;
  const last = alliances.length;
  if (currentSlot === "captain") {
    if (currentSeed < last) return { currentSeed: currentSeed + 1, currentSlot: "captain" };
    return { currentSeed: 1, currentSlot: "first" };
  }
  if (currentSlot === "first") {
    if (currentSeed < last) return { currentSeed: currentSeed + 1, currentSlot: "first" };
    return { currentSeed: last, currentSlot: "second" };
  }
  if (currentSeed > 1) return { currentSeed: currentSeed - 1, currentSlot: "second" };
  return { currentSeed: 1, currentSlot: "second" };
}

/**
 * Put `teamKey` in (or clear) one alliance slot. A team already sitting elsewhere is lifted
 * first — the desk and the spine both enforce one team per slot.
 */
export function applySlotToAllianceBoardState(
  state: AllianceBoardState,
  slot: AllianceBoardSlotRef,
  teamKey: string | null,
): AllianceBoardState {
  const field = allianceSlotField(slot.pickSlot);
  const previous = state.alliances.find((row) => row.seed === slot.allianceSeed)?.[field] ?? null;

  const alliances = state.alliances.map((row) => {
    const cleared =
      teamKey &&
      (row.captainTeamKey === teamKey ||
        row.firstPickTeamKey === teamKey ||
        row.secondPickTeamKey === teamKey)
        ? {
            ...row,
            captainTeamKey: row.captainTeamKey === teamKey ? null : row.captainTeamKey,
            firstPickTeamKey: row.firstPickTeamKey === teamKey ? null : row.firstPickTeamKey,
            secondPickTeamKey: row.secondPickTeamKey === teamKey ? null : row.secondPickTeamKey,
          }
        : { ...row };
    if (cleared.seed !== slot.allianceSeed) return cleared;
    return { ...cleared, [field]: teamKey };
  });

  let availableTeamKeys = state.availableTeamKeys.filter((key) => key !== teamKey && key !== previous);
  if (previous && previous !== teamKey) availableTeamKeys = [...availableTeamKeys, previous];

  const next: AllianceBoardState = {
    ...state,
    alliances,
    availableTeamKeys,
    pickListId: state.pickListId,
    currentSeed: slot.allianceSeed,
    currentSlot: slot.pickSlot,
  };

  if (teamKey) {
    return { ...next, ...advanceAllianceCursor(next) };
  }
  return next;
}

export type AllianceBoardMirrorResult = {
  mirrored: boolean;
  boardId: string | null;
};

/**
 * Upsert the event's Draft day row so the desk and the clock name the same occupant.
 *
 * alliance_boards INSERT/UPDATE (0505) grant owner+admin, plus a drive-team/captain-capable
 * org_role when one exists. Today's enum is owner|admin|scout|viewer — no captain, drive_team,
 * or mentor — so the applied set is owner+admin. `scout` is never granted (that would let every
 * student write the desk). A scout-role captain can still record on pick_list_entries; this
 * returns `{ mirrored: false }` instead of throwing so undo/record on the spine is never rolled
 * back by a desk permission miss.
 */
export async function mirrorPickToAllianceBoard(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    pickListId: string;
    slot: AllianceBoardSlotRef;
    teamKey: string | null;
  },
): Promise<AllianceBoardMirrorResult> {
  try {
    const existing = await client.query<{
      id: string;
      state: unknown;
      pickListId: string | null;
    }>(
      `SELECT id, state, pick_list_id AS "pickListId"
       FROM alliance_boards
       WHERE org_id = $1::uuid AND event_key = $2::text
       ORDER BY CASE WHEN pick_list_id = $3::uuid THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [input.orgId, input.eventKey, input.pickListId],
    );

    const teamKeys = (
      await client.query<{ teamKey: string }>(
        `SELECT DISTINCT team_key AS "teamKey" FROM team_event_metrics WHERE event_key = $1::text`,
        [input.eventKey],
      )
    ).rows.map((row) => row.teamKey);

    const base = normalizeAllianceBoardState(existing.rows[0]?.state, teamKeys);
    const next = applySlotToAllianceBoardState(
      { ...base, pickListId: input.pickListId },
      input.slot,
      input.teamKey,
    );

    if (existing.rows[0]) {
      const updated = await client.query<{ id: string }>(
        `UPDATE alliance_boards
         SET state = $4::jsonb,
             pick_list_id = $3::uuid,
             updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid
         RETURNING id`,
        [existing.rows[0].id, input.orgId, input.pickListId, JSON.stringify(next)],
      );
      const boardId = updated.rows[0]?.id ?? null;
      return { mirrored: Boolean(boardId), boardId };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO alliance_boards(org_id, event_key, name, pick_list_id, state, created_by)
       VALUES ($1::uuid, $2::text, 'Draft day', $3::uuid, $4::jsonb, $5::uuid)
       ON CONFLICT (org_id, event_key, name) DO UPDATE SET
         state = EXCLUDED.state,
         pick_list_id = EXCLUDED.pick_list_id,
         updated_at = now()
       RETURNING id`,
      [input.orgId, input.eventKey, input.pickListId, JSON.stringify(next), input.userId],
    );
    const boardId = inserted.rows[0]?.id ?? null;
    return { mirrored: Boolean(boardId), boardId };
  } catch {
    return { mirrored: false, boardId: null };
  }
}
