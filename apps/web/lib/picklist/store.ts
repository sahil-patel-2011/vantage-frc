// THE single pick-list read/write API. Collaborative ranking, the alliance-selection desk,
// Pick Clock and the justifier all go through here, so reordering in one surface moves the list
// everywhere and the justifier explains the row that is actually on the board.
//
// Backed by pick_lists / pick_list_entries / pick_list_entry_votes (migration 0454).
// Request-path only: parameterized SQL through the PoolClient handed out by withRls, never
// @vantage/db/admin. Every statement is org-scoped in addition to RLS.

import type { PoolClient } from "@neondatabase/serverless";
import {
  aggregateVotes,
  applyReorder,
  bucketFromTier,
  clampVoteWeight,
  detectReorderConflict,
  normalizeTeamKey,
  rankAssignments,
  sortPickEntries,
  tierFromBucket,
} from "./ordering";
import type {
  BoardSlot,
  BoardStateView,
  DraftPickSlot,
  JustificationSource,
  PickBucket,
  PickListEntry,
  PickListRecord,
  PickListSnapshot,
  PickListStatus,
  PickListVote,
  ReorderConflict,
} from "./types";

export const DRAFT_PICK_SLOTS: DraftPickSlot[] = ["captain", "first", "second"];
export const ALLIANCE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

const LIST_COLUMNS = `
  p.id, p.org_id AS "orgId", p.event_key AS "eventKey", p.name,
  p.season_year AS "seasonYear", p.status, p.source, p.board_state AS "boardState",
  p.created_by AS "createdBy", p.updated_by AS "updatedBy", u.name AS "updatedByName",
  p.updated_at::text AS "updatedAt", p.revision`;

type ListRow = {
  id: string;
  orgId: string;
  eventKey: string;
  name: string;
  seasonYear: number | null;
  status: PickListStatus;
  source: PickListRecord["source"];
  boardState: unknown;
  createdBy: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  revision: string | number;
  entryCount?: string | number;
};

type EntryRow = {
  id: string;
  pickListId: string;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  rank: number;
  bucket: PickBucket;
  tier: string | null;
  notes: string | null;
  addedBy: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  revision: string | number;
  justification: string | null;
  justificationSources: unknown;
  justificationContradiction: boolean;
  justificationReason: string | null;
  justificationGeneratedAt: string | null;
  draftedAllianceSeed: number | null;
  draftedPickSlot: DraftPickSlot | null;
  draftedAt: string | null;
  boardRationale: string | null;
};

type VoteRow = {
  id: string;
  entryId: string;
  voterId: string;
  voterName: string | null;
  weight: string | number;
  rankSuggestion: number | null;
  comment: string | null;
  updatedAt: string;
};

function mapList(row: ListRow, entryCount: number): PickListRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    eventKey: row.eventKey,
    name: row.name,
    seasonYear: row.seasonYear == null ? null : Number(row.seasonYear),
    status: row.status,
    source: row.source,
    boardState:
      row.boardState && typeof row.boardState === "object"
        ? (row.boardState as Record<string, unknown>)
        : {},
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt,
    revision: Number(row.revision) || 1,
    entryCount,
  };
}

function mapVote(row: VoteRow): PickListVote {
  return {
    id: row.id,
    voterId: row.voterId,
    voterName: row.voterName,
    weight: Number(row.weight) || 0,
    rankSuggestion: row.rankSuggestion == null ? null : Number(row.rankSuggestion),
    comment: row.comment,
    updatedAt: row.updatedAt,
  };
}

function mapEntry(row: EntryRow, votes: PickListVote[]): PickListEntry {
  const aggregate = aggregateVotes(votes);
  return {
    id: row.id,
    pickListId: row.pickListId,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber == null ? null : Number(row.teamNumber),
    nickname: row.nickname,
    rank: Number(row.rank),
    bucket: row.bucket,
    tier: row.tier,
    notes: row.notes,
    addedBy: row.addedBy,
    updatedBy: row.updatedBy,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt,
    revision: Number(row.revision) || 1,
    votes,
    weightedScore: aggregate.weightedScore,
    averageRankSuggestion: aggregate.averageRankSuggestion,
    justification: row.justification,
    justificationSources: Array.isArray(row.justificationSources)
      ? (row.justificationSources as JustificationSource[])
      : [],
    justificationContradiction: Boolean(row.justificationContradiction),
    justificationReason: row.justificationReason,
    justificationGeneratedAt: row.justificationGeneratedAt,
    draftedAllianceSeed: row.draftedAllianceSeed == null ? null : Number(row.draftedAllianceSeed),
    draftedPickSlot: row.draftedPickSlot,
    draftedAt: row.draftedAt,
    boardRationale: row.boardRationale ?? "",
  };
}

// ------------------------------------------------------------------ reads

export async function listPickLists(
  client: PoolClient,
  input: { orgId: string; eventKey?: string | null },
): Promise<PickListRecord[]> {
  const result = await client.query<ListRow>(
    `SELECT ${LIST_COLUMNS},
            (SELECT COUNT(*) FROM pick_list_entries e WHERE e.pick_list_id = p.id)::text AS "entryCount"
     FROM pick_lists p
     LEFT JOIN users u ON u.id = p.updated_by
     WHERE p.org_id = $1::uuid
       AND ($2::text IS NULL OR p.event_key = $2::text)
     ORDER BY p.updated_at DESC`,
    [input.orgId, input.eventKey ?? null],
  );
  return result.rows.map((row) => mapList(row, Number(row.entryCount) || 0));
}

/**
 * THE read. Resolves one list (explicit id wins, else the most recently touched list for the
 * event, else the org's most recent) and returns it with every entry, vote, justification and
 * board placement attached. Returns null when the org has no list yet — the caller shows an
 * honest empty state, never a fabricated list.
 */
export async function listPickList(
  client: PoolClient,
  input: { orgId: string; eventKey?: string | null; pickListId?: string | null },
): Promise<PickListSnapshot | null> {
  const listResult = await client.query<ListRow>(
    `SELECT ${LIST_COLUMNS}
     FROM pick_lists p
     LEFT JOIN users u ON u.id = p.updated_by
     WHERE p.org_id = $1::uuid
       AND ($2::uuid IS NULL OR p.id = $2::uuid)
       AND ($3::text IS NULL OR p.event_key = $3::text)
     ORDER BY p.updated_at DESC
     LIMIT 1`,
    [input.orgId, input.pickListId ?? null, input.eventKey ?? null],
  );
  const listRow = listResult.rows[0];
  if (!listRow) return null;

  const [entryResult, voteResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT e.id, e.pick_list_id AS "pickListId", e.team_key AS "teamKey",
              COALESCE(e.team_number, t.team_number) AS "teamNumber", t.nickname,
              e.rank, e.bucket, e.tier, e.notes,
              e.added_by AS "addedBy", e.updated_by AS "updatedBy", u.name AS "updatedByName",
              e.updated_at::text AS "updatedAt", e.revision,
              e.justification, e.justification_sources AS "justificationSources",
              e.justification_contradiction AS "justificationContradiction",
              e.justification_reason AS "justificationReason",
              e.justification_generated_at::text AS "justificationGeneratedAt",
              e.drafted_alliance_seed AS "draftedAllianceSeed",
              e.drafted_pick_slot AS "draftedPickSlot",
              e.drafted_at::text AS "draftedAt",
              e.board_rationale AS "boardRationale"
       FROM pick_list_entries e
       LEFT JOIN teams_ref t ON t.team_key = e.team_key
       LEFT JOIN users u ON u.id = e.updated_by
       WHERE e.org_id = $1::uuid AND e.pick_list_id = $2::uuid
       ORDER BY e.rank`,
      [input.orgId, listRow.id],
    ),
    client.query<VoteRow>(
      `SELECT v.id, v.entry_id AS "entryId", v.voter_id AS "voterId", u.name AS "voterName",
              v.weight, v.rank_suggestion AS "rankSuggestion", v.comment,
              v.updated_at::text AS "updatedAt"
       FROM pick_list_entry_votes v
       JOIN pick_list_entries e ON e.id = v.entry_id
       LEFT JOIN users u ON u.id = v.voter_id
       WHERE v.org_id = $1::uuid AND e.pick_list_id = $2::uuid`,
      [input.orgId, listRow.id],
    ),
  ]);

  const votesByEntry = new Map<string, PickListVote[]>();
  for (const row of voteResult.rows) {
    const list = votesByEntry.get(row.entryId) ?? [];
    list.push(mapVote(row));
    votesByEntry.set(row.entryId, list);
  }

  const entries = sortPickEntries(
    entryResult.rows.map((row) => mapEntry(row, votesByEntry.get(row.id) ?? [])),
  );

  return { list: mapList(listRow, entries.length), entries };
}

/** The draft board projected off the spine — 8 alliances x 3 slots, filled from drafted_*. */
export async function boardState(
  client: PoolClient,
  input: { orgId: string; eventKey?: string | null; pickListId?: string | null },
): Promise<BoardStateView | null> {
  const snapshot = await listPickList(client, input);
  if (!snapshot) return null;

  const bySlot = new Map<string, PickListEntry>();
  for (const entry of snapshot.entries) {
    if (entry.draftedAllianceSeed != null && entry.draftedPickSlot) {
      bySlot.set(`${entry.draftedAllianceSeed}:${entry.draftedPickSlot}`, entry);
    }
  }

  const slots: BoardSlot[] = [];
  for (const seed of ALLIANCE_SEEDS) {
    for (const pickSlot of DRAFT_PICK_SLOTS) {
      const entry = bySlot.get(`${seed}:${pickSlot}`) ?? null;
      slots.push({
        allianceSeed: seed,
        pickSlot,
        entryId: entry?.id ?? null,
        teamKey: entry?.teamKey ?? null,
        teamNumber: entry?.teamNumber ?? null,
        nickname: entry?.nickname ?? null,
        rank: entry?.rank ?? null,
        bucket: entry?.bucket ?? null,
        rationale: entry?.boardRationale ?? "",
        justification: entry?.justification ?? null,
        draftedAt: entry?.draftedAt ?? null,
      });
    }
  }

  return {
    pickListId: snapshot.list.id,
    eventKey: snapshot.list.eventKey,
    slots,
    draftedTeamKeys: [...bySlot.values()].map((entry) => entry.teamKey),
    updatedAt: snapshot.list.updatedAt,
  };
}

// ------------------------------------------------------------------ writes

async function touchList(
  client: PoolClient,
  input: { orgId: string; pickListId: string; userId: string },
): Promise<void> {
  await client.query(
    `UPDATE pick_lists
     SET updated_at = now(), updated_by = $3::uuid, revision = revision + 1
     WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.pickListId, input.userId],
  );
}

async function assertWritable(
  client: PoolClient,
  input: { orgId: string; pickListId: string },
): Promise<PickListStatus> {
  const result = await client.query<{ status: PickListStatus }>(
    `SELECT status FROM pick_lists WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.pickListId],
  );
  const status = result.rows[0]?.status;
  if (!status) throw new Error("Pick list not found");
  if (status !== "open") throw new Error(`This pick list is ${status} — reopen it to make changes.`);
  return status;
}

/**
 * Find-or-create the list for an event. Every surface calls this instead of minting its own
 * private list, which is what created the islands in the first place.
 */
export async function ensurePickList(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    name?: string | null;
    seasonYear?: number | null;
    source?: PickListRecord["source"];
  },
): Promise<string> {
  const name = (input.name ?? "").trim() || "Pick list";
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM pick_lists
     WHERE org_id = $1::uuid AND event_key = $2::text AND name = $3::text`,
    [input.orgId, input.eventKey, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const seasonYear =
    input.seasonYear ??
    (/^\d{4}/.test(input.eventKey) ? Number(input.eventKey.slice(0, 4)) : null);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO pick_lists (org_id, event_key, name, created_by, updated_by, season_year, source)
     VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $4::uuid, $5::int, $6::text)
     RETURNING id`,
    [input.orgId, input.eventKey, name, input.userId, seasonYear, input.source ?? "manual"],
  );
  return inserted.rows[0]!.id;
}

export async function setListStatus(
  client: PoolClient,
  input: { orgId: string; userId: string | null; pickListId: string; status: PickListStatus },
): Promise<void> {
  await client.query(
    `UPDATE pick_lists
     SET status = $3::text,
         updated_at = now(),
         updated_by = COALESCE($4::uuid, current_app_user_id(), updated_by),
         revision = revision + 1
     WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.pickListId, input.status, input.userId],
  );
}

export async function setBoardScratch(
  client: PoolClient,
  input: { orgId: string; userId: string; pickListId: string; boardState: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `UPDATE pick_lists
     SET board_state = $3::jsonb, updated_at = now(), updated_by = $4::uuid, revision = revision + 1
     WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.pickListId, JSON.stringify(input.boardState ?? {}), input.userId],
  );
}

/**
 * Add or update one team on the list. New teams land at the end of their bucket; an existing
 * team keeps its rank unless the bucket changes.
 */
export async function upsertEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pickListId: string;
    teamKey: string | number;
    bucket?: PickBucket;
    notes?: string | null;
  },
): Promise<string> {
  await assertWritable(client, input);
  const teamKey = normalizeTeamKey(input.teamKey);
  if (!teamKey) throw new Error("A valid team number is required");

  const known = await client.query(`SELECT 1 FROM teams_ref WHERE team_key = $1::text`, [teamKey]);
  if (!known.rowCount) {
    throw new Error(
      `${teamKey.replace(/^frc/, "")} is not in the official team list yet — sync the event first.`,
    );
  }

  const bucket = input.bucket ?? "unranked";
  const nextRank = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(rank), 0) + 1 AS next FROM pick_list_entries WHERE pick_list_id = $1::uuid`,
    [input.pickListId],
  );

  const result = await client.query<{ id: string }>(
    `INSERT INTO pick_list_entries
       (pick_list_id, org_id, team_key, team_number, rank, bucket, tier, notes, added_by, updated_by)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::int, $5::int, $6::text, $7::text, $8::text, $9::uuid, $9::uuid)
     ON CONFLICT (pick_list_id, team_key) DO UPDATE SET
       bucket = EXCLUDED.bucket,
       tier = EXCLUDED.tier,
       notes = COALESCE(EXCLUDED.notes, pick_list_entries.notes),
       team_number = COALESCE(EXCLUDED.team_number, pick_list_entries.team_number),
       updated_by = EXCLUDED.updated_by,
       updated_at = now(),
       revision = pick_list_entries.revision + 1
     RETURNING id`,
    [
      input.pickListId,
      input.orgId,
      teamKey,
      Number(teamKey.slice(3)),
      nextRank.rows[0]?.next ?? 1,
      bucket,
      tierFromBucket(bucket),
      input.notes ?? null,
      input.userId,
    ],
  );

  await renormalizeRanks(client, { orgId: input.orgId, pickListId: input.pickListId });
  await touchList(client, { ...input, userId: input.userId });
  return result.rows[0]!.id;
}

export async function setEntryNotes(
  client: PoolClient,
  input: { orgId: string; userId: string; pickListId: string; entryId: string; notes: string | null },
): Promise<void> {
  await client.query(
    `UPDATE pick_list_entries
     SET notes = $4::text, updated_by = $5::uuid, updated_at = now(), revision = revision + 1
     WHERE org_id = $1::uuid AND pick_list_id = $2::uuid AND id = $3::uuid`,
    [input.orgId, input.pickListId, input.entryId, input.notes, input.userId],
  );
  await touchList(client, input);
}

export async function deleteEntry(
  client: PoolClient,
  input: { orgId: string; userId: string; pickListId: string; entryId: string },
): Promise<void> {
  await assertWritable(client, input);
  await client.query(
    `DELETE FROM pick_list_entries
     WHERE org_id = $1::uuid AND pick_list_id = $2::uuid AND id = $3::uuid`,
    [input.orgId, input.pickListId, input.entryId],
  );
  await renormalizeRanks(client, { orgId: input.orgId, pickListId: input.pickListId });
  await touchList(client, input);
}

/**
 * Collapse ranks back to a dense 1..n in display order. Cheap, and it keeps rank meaning the same
 * thing on every device. Relies on the DEFERRABLE unique (pick_list_id, rank) added in 0454, so
 * the intermediate state inside this transaction is allowed to collide.
 */
export async function renormalizeRanks(
  client: PoolClient,
  input: { orgId: string; pickListId: string },
): Promise<void> {
  await client.query(
    `WITH ordered AS (
       SELECT id, row_number() OVER (
         ORDER BY CASE bucket
                    WHEN 'first_pick' THEN 0
                    WHEN 'second_pick' THEN 1
                    WHEN 'unranked' THEN 2
                    ELSE 3
                  END,
                  rank, team_number NULLS LAST, id
       ) AS rn
       FROM pick_list_entries
       WHERE org_id = $1::uuid AND pick_list_id = $2::uuid
     )
     UPDATE pick_list_entries e
     SET rank = o.rn
     FROM ordered o
     WHERE e.id = o.id AND e.rank <> o.rn`,
    [input.orgId, input.pickListId],
  );
}

export type ReorderResult = {
  conflict: ReorderConflict | null;
  snapshot: PickListSnapshot | null;
};

/**
 * Drag-and-drop reorder. Deterministic and last-write-wins: the move always lands, but when the
 * caller's `expectedRevision` is behind we hand back a conflict naming who moved it first so the
 * surface can say "updated by X" instead of silently swallowing the other device's work.
 */
export async function reorderEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pickListId: string;
    entryId: string;
    toIndex: number;
    bucket?: PickBucket;
    expectedRevision?: number | null;
  },
): Promise<ReorderResult> {
  await assertWritable(client, input);

  const current = await client.query<{
    revision: string | number;
    updatedByName: string | null;
    updatedAt: string;
  }>(
    `SELECT p.revision, u.name AS "updatedByName", p.updated_at::text AS "updatedAt"
     FROM pick_lists p
     LEFT JOIN users u ON u.id = p.updated_by
     WHERE p.org_id = $1::uuid AND p.id = $2::uuid`,
    [input.orgId, input.pickListId],
  );
  const listRow = current.rows[0];
  if (!listRow) throw new Error("Pick list not found");

  const conflict = detectReorderConflict({
    expectedRevision: input.expectedRevision,
    actualRevision: Number(listRow.revision) || 1,
    lastEditedBy: listRow.updatedByName,
    lastEditedAt: listRow.updatedAt,
  });

  const existing = await client.query<{
    id: string;
    rank: number;
    bucket: PickBucket;
    teamNumber: number | null;
  }>(
    `SELECT id, rank, bucket, team_number AS "teamNumber"
     FROM pick_list_entries
     WHERE org_id = $1::uuid AND pick_list_id = $2::uuid`,
    [input.orgId, input.pickListId],
  );

  const reordered = applyReorder(
    existing.rows.map((row) => ({
      id: row.id,
      rank: Number(row.rank),
      bucket: row.bucket,
      teamNumber: row.teamNumber == null ? null : Number(row.teamNumber),
    })),
    { entryId: input.entryId, toIndex: input.toIndex, bucket: input.bucket },
  );

  const { ids, ranks } = rankAssignments(reordered);
  if (ids.length > 0) {
    await client.query(
      `UPDATE pick_list_entries e
       SET rank = v.rank,
           updated_by = $4::uuid,
           updated_at = now(),
           revision = e.revision + 1
       FROM (SELECT unnest($2::uuid[]) AS id, unnest($3::int[]) AS rank) v
       WHERE e.id = v.id AND e.pick_list_id = $1::uuid AND e.rank IS DISTINCT FROM v.rank`,
      [input.pickListId, ids, ranks, input.userId],
    );
  }

  if (input.bucket) {
    await client.query(
      `UPDATE pick_list_entries
       SET bucket = $4::text, tier = $5::text, updated_by = $6::uuid, updated_at = now(),
           revision = revision + 1
       WHERE org_id = $1::uuid AND pick_list_id = $2::uuid AND id = $3::uuid`,
      [
        input.orgId,
        input.pickListId,
        input.entryId,
        input.bucket,
        tierFromBucket(input.bucket),
        input.userId,
      ],
    );
  }

  await touchList(client, input);
  const snapshot = await listPickList(client, {
    orgId: input.orgId,
    pickListId: input.pickListId,
  });
  return { conflict, snapshot };
}

export async function recordVote(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pickListId: string;
    entryId: string;
    weight: number;
    rankSuggestion?: number | null;
    comment?: string | null;
  },
): Promise<void> {
  const owned = await client.query(
    `SELECT 1 FROM pick_list_entries
     WHERE org_id = $1::uuid AND pick_list_id = $2::uuid AND id = $3::uuid`,
    [input.orgId, input.pickListId, input.entryId],
  );
  if (!owned.rowCount) throw new Error("Pick-list entry not found");

  await client.query(
    `INSERT INTO pick_list_entry_votes (org_id, entry_id, voter_id, weight, rank_suggestion, comment)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::int, $6::text)
     ON CONFLICT (entry_id, voter_id) DO UPDATE SET
       weight = EXCLUDED.weight,
       rank_suggestion = EXCLUDED.rank_suggestion,
       comment = EXCLUDED.comment,
       updated_at = now()`,
    [
      input.orgId,
      input.entryId,
      input.userId,
      clampVoteWeight(input.weight),
      input.rankSuggestion ?? null,
      input.comment ?? null,
    ],
  );
  await touchList(client, input);
}

export async function removeVote(
  client: PoolClient,
  input: { orgId: string; userId: string; pickListId: string; entryId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM pick_list_entry_votes
     WHERE org_id = $1::uuid AND entry_id = $2::uuid AND voter_id = $3::uuid`,
    [input.orgId, input.entryId, input.userId],
  );
  await touchList(client, input);
}

/**
 * Attach a source-cited rationale to the row that is actually on the list. The justifier used to
 * write a sidecar table; now the explanation travels with the pick.
 */
export async function setJustification(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pickListId: string;
    entryId: string;
    rationale: string;
    sources: JustificationSource[];
    contradictionFlagged: boolean;
    contradictionReason: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE pick_list_entries
     SET justification = $4::text,
         justification_sources = $5::jsonb,
         justification_contradiction = $6::boolean,
         justification_reason = $7::text,
         justification_generated_at = now(),
         updated_by = $8::uuid,
         updated_at = now(),
         revision = revision + 1
     WHERE org_id = $1::uuid AND pick_list_id = $2::uuid AND id = $3::uuid`,
    [
      input.orgId,
      input.pickListId,
      input.entryId,
      input.rationale,
      JSON.stringify(input.sources ?? []),
      input.contradictionFlagged,
      input.contradictionReason,
      input.userId,
    ],
  );
}

/**
 * Put a team in (or clear) an alliance slot. The spine is the source of truth for who is on the
 * board, so Pick Clock stops recommending a team the desk already drafted. A drafted team that
 * was never ranked is appended to the list rather than lost.
 */
export async function setBoardSlot(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pickListId: string;
    allianceSeed: number;
    pickSlot: DraftPickSlot;
    teamKey: string | number | null;
    rationale?: string | null;
  },
): Promise<void> {
  if (!ALLIANCE_SEEDS.includes(input.allianceSeed)) throw new Error("allianceSeed must be 1-8");
  if (!DRAFT_PICK_SLOTS.includes(input.pickSlot)) throw new Error("Unknown pick slot");

  // Free the slot first so the partial unique index can accept the new occupant.
  await client.query(
    `UPDATE pick_list_entries
     SET drafted_alliance_seed = NULL, drafted_pick_slot = NULL, drafted_at = NULL,
         drafted_by = NULL, updated_by = $4::uuid, updated_at = now(), revision = revision + 1
     WHERE org_id = $1::uuid AND pick_list_id = $2::uuid
       AND drafted_alliance_seed = $3::int AND drafted_pick_slot = $5::text`,
    [input.orgId, input.pickListId, input.allianceSeed, input.userId, input.pickSlot],
  );

  const teamKey = input.teamKey == null ? null : normalizeTeamKey(input.teamKey);
  if (!teamKey) {
    await touchList(client, input);
    return;
  }

  const entryId = await upsertEntry(client, {
    orgId: input.orgId,
    userId: input.userId,
    pickListId: input.pickListId,
    teamKey,
  });

  // A team can only sit in one slot — clear any earlier placement before stamping this one.
  await client.query(
    `UPDATE pick_list_entries
     SET drafted_alliance_seed = $4::int,
         drafted_pick_slot = $5::text,
         drafted_at = now(),
         drafted_by = $6::uuid,
         board_rationale = COALESCE($7::text, board_rationale),
         updated_by = $6::uuid,
         updated_at = now(),
         revision = revision + 1
     WHERE org_id = $1::uuid AND pick_list_id = $2::uuid AND id = $3::uuid`,
    [
      input.orgId,
      input.pickListId,
      entryId,
      input.allianceSeed,
      input.pickSlot,
      input.userId,
      input.rationale ?? null,
    ],
  );

  await touchList(client, input);
}

/** Convenience for surfaces that only know a tier string (Strategy / Intel-Research imports). */
export async function upsertEntryFromTier(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pickListId: string;
    teamKey: string | number;
    tier: string | null;
    notes?: string | null;
  },
): Promise<string> {
  return upsertEntry(client, { ...input, bucket: bucketFromTier(input.tier) });
}
