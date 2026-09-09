// Pairwise tap order to the ONE pick list.
//
// Pairwise used to rank robots from A-beats-B taps and then stop: the order lived only on
// /pairwise. This writes that order onto pick_lists / pick_list_entries (migration 0454) through
// lib/picklist/store.ts so the desk, Pick Clock and draft board read the same rows.
//
// Empty ranks stay empty. There is no DEMO field and no invented EPA order — the payload is
// derived from recorded comparisons only.

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepointOrThrow } from "@vantage/db";
import {
  ensurePickList,
  isPickBucket,
  listPickLists,
  normalizeTeamKey,
  reorderEntry,
  upsertEntry,
  type PickBucket,
} from "../picklist";
import { parseTeamNumber, type PairwiseRank } from "./rank";

export type PairwisePromotePayload = {
  /** Canonical frc#### keys in Bradley-Terry order. Empty when nobody has tapped. */
  teamKeys: string[];
  /** Inputs that were not valid team numbers — reported, never silently dropped. */
  rejected: string[];
  notesByTeam: Record<string, string>;
};

export type PairwisePromoteResult = {
  pickListId: string | null;
  /** Team keys actually written, in the order they were promoted. */
  promoted: string[];
  rejected: string[];
  bucket: PickBucket;
  message: string;
};

const EMPTY_PROMOTE_MESSAGE =
  "Nothing to promote — ranks stay empty until someone records a real A-beats-B tap.";

/**
 * Turn recorded Bradley-Terry ranks into a pick-list write. Empty input stays empty — no
 * invented DEMO teams, no TBA order padded in.
 */
export function pairwisePromotePayload(
  ranks: Array<Pick<PairwiseRank, "teamNumber" | "rank">>,
  criterionName?: string | null,
): PairwisePromotePayload {
  const teamKeys: string[] = [];
  const rejected: string[] = [];
  const notesByTeam: Record<string, string> = {};
  const criterion =
    typeof criterionName === "string" && criterionName.trim()
      ? criterionName.trim().slice(0, 80)
      : "recorded taps";
  const ordered = [...ranks].sort((a, b) => a.rank - b.rank || a.teamNumber - b.teamNumber);

  for (const row of ordered) {
    const teamNumber = parseTeamNumber(row.teamNumber);
    const key = teamNumber != null ? normalizeTeamKey(teamNumber) : null;
    if (!key) {
      rejected.push(String(row.teamNumber ?? "").trim().slice(0, 16));
      continue;
    }
    if (teamKeys.includes(key)) continue;
    teamKeys.push(key);
    notesByTeam[key] = `Pairwise #${row.rank} · ${criterion}`;
  }

  return { teamKeys, rejected, notesByTeam };
}

export function bucketOrDefault(value: unknown, fallback: PickBucket = "unranked"): PickBucket {
  return isPickBucket(value) ? value : fallback;
}

/**
 * Promote the pairwise tap order onto the canonical pick list for an event.
 *
 * Idempotent: upsertEntry conflicts on (pick_list_id, team_key). An empty rank list never
 * creates a stray pick list. A team with no teams_ref row is reported as rejected rather
 * than invented.
 */
export async function promotePairwiseOrder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string | null | undefined;
    ranks: Array<Pick<PairwiseRank, "teamNumber" | "rank">>;
    criterionName?: string | null;
    bucket?: unknown;
    pickListId?: string | null;
    listName?: string | null;
  },
): Promise<PairwisePromoteResult> {
  const bucket = bucketOrDefault(input.bucket);
  const payload = pairwisePromotePayload(input.ranks, input.criterionName);
  if (!payload.teamKeys.length) {
    return {
      pickListId: null,
      promoted: [],
      rejected: payload.rejected,
      bucket,
      message: EMPTY_PROMOTE_MESSAGE,
    };
  }

  const eventKey = typeof input.eventKey === "string" ? input.eventKey.trim() : "";
  if (!eventKey) {
    throw new Error("Set an active event before promoting pairwise ranks to the pick list.");
  }

  // Join the list the desk and Pick Clock already use; only create when the org has none yet.
  const existing = input.pickListId
    ? null
    : (await listPickLists(client, { orgId: input.orgId, eventKey }))[0];
  const pickListId =
    input.pickListId ??
    existing?.id ??
    (await ensurePickList(client, {
      orgId: input.orgId,
      userId: input.userId,
      eventKey,
      name: input.listName ?? null,
      source: "strategy",
    }));

  const promoted: string[] = [];
  const unknownTeams: string[] = [];
  const entryIds: string[] = [];
  for (const teamKey of payload.teamKeys) {
    // Per-team savepoint: an unknown team raises a foreign key violation, which
    // aborts the transaction, so `continue` used to hand a dead transaction to the
    // next team — whose "current transaction is aborted" then failed the /team
    // reference/ test and rethrew, discarding every team promoted before it.
    let entryId: string | null;
    try {
      entryId = await withSavepointOrThrow(client, () =>
        upsertEntry(client, {
          orgId: input.orgId,
          userId: input.userId,
          pickListId,
          teamKey,
          bucket,
          notes: payload.notesByTeam[teamKey] ?? null,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/team reference/i.test(message)) throw error;
      entryId = null;
    }
    if (entryId === null) {
      unknownTeams.push(teamKey);
      continue;
    }
    promoted.push(teamKey);
    entryIds.push(entryId);
  }

  // Last-to-first so pairwise #1 lands at the top; other list rows are pushed down, not deleted.
  for (let index = entryIds.length - 1; index >= 0; index -= 1) {
    await reorderEntry(client, {
      orgId: input.orgId,
      userId: input.userId,
      pickListId,
      entryId: entryIds[index]!,
      toIndex: 0,
      bucket,
    });
  }

  const allRejected = [...payload.rejected, ...unknownTeams];
  return {
    pickListId,
    promoted,
    rejected: allRejected,
    bucket,
    message: promoted.length
      ? `Saved pairwise order ${promoted.map((key) => key.replace(/^frc/, "")).join(", ")} to the pick list.${
          allRejected.length
            ? ` Skipped ${allRejected.join(", ")} — sync the event teams first.`
            : ""
        }`
      : `Nothing was saved — ${allRejected.join(", ")} are not in the synced event teams yet.`,
  };
}
