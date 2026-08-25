// Collaborative pick-list view — now a PROJECTION of the ONE pick list.
//
// This module used to own picklist_collab_lists/_entries/_votes, which meant the list a team
// built together was not the list the alliance-selection desk read on Saturday. It now reads and
// writes pick_lists / pick_list_entries / pick_list_entry_votes through lib/picklist/store.ts
// (migration 0454), so a reorder here moves the draft board and Pick Clock too. The view shape is
// unchanged so the collaborative UI keeps working exactly as before.

import type { PoolClient } from "@neondatabase/serverless";
import {
  ensurePickList,
  listPickList,
  listPickLists,
  recordVote,
  removeVote as removeVoteFromSpine,
  reorderEntry,
  setListStatus,
  upsertEntry,
  deleteEntry as deleteSpineEntry,
  teamNumberFromKey,
  type PickBucket,
  type PickListEntry,
  type PickListSnapshot,
} from "../picklist";
import { classifyEpaRole, fieldEpaBenchmarks, sortEntriesForDisplay, summarizePicklistCollab } from ".";
import type {
  PicklistCollabEntry,
  PicklistCollabList,
  PicklistCollabListStatus,
  PicklistCollabSummary,
  PicklistCollabTier,
  PicklistCollabVote,
} from "./types";

export type PicklistCollabSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type PicklistCollabView =
  | {
      status: "setup_required";
      message: string;
      steps: PicklistCollabSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      lists: PicklistCollabList[];
      activeList: PicklistCollabList | null;
      entries: PicklistCollabEntry[];
      summary: PicklistCollabSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/**
 * The collab tool's tier vocabulary IS the spine's bucket vocabulary (that was the point of the
 * unification) — these two casts document the intent rather than translating anything.
 */
function tierFromBucket(bucket: PickBucket): PicklistCollabTier {
  return bucket;
}
function bucketFromTier(tier: PicklistCollabTier): PickBucket {
  return tier;
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; eventKey: string | null } | null> {
  const membership = await client.query<{
    orgId: string;
    teamNumber: number | null;
    eventKey: string | null;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", c.active_event_key AS "eventKey"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

function setupRequired(orgId: string | null): PicklistCollabView {
  return {
    status: "setup_required",
    message: "Select a team workspace to build a collaborative pick list.",
    steps: [
      { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
    ],
    orgId,
  };
}

function toCollabList(record: {
  id: string;
  eventKey: string;
  name: string;
  seasonYear: number | null;
  status: PicklistCollabListStatus | string;
  createdBy: string;
  updatedAt: string;
}): PicklistCollabList {
  const status = (["open", "locked", "archived"] as string[]).includes(record.status)
    ? (record.status as PicklistCollabListStatus)
    : "open";
  return {
    id: record.id,
    eventKey: record.eventKey,
    name: record.name,
    seasonYear: record.seasonYear ?? currentSeasonYear(),
    status,
    createdBy: record.createdBy,
    updatedAt: record.updatedAt,
  };
}

function toCollabVote(vote: PickListEntry["votes"][number]): PicklistCollabVote {
  return {
    id: vote.id,
    voterId: vote.voterId,
    weight: vote.weight,
    rankSuggestion: vote.rankSuggestion,
    comment: vote.comment,
    updatedAt: vote.updatedAt,
  };
}

/** Cached Statbotics/TBA EPA for the event field — never fabricated when a row is missing. */
async function loadEventEpa(
  client: PoolClient,
  eventKey: string,
): Promise<{
  byTeam: Map<number, { epaTotal: number | null; epaAuto: number | null; epaTeleop: number | null }>;
  bench: { median: number; p75: number } | null;
}> {
  const result = await client.query<{
    teamKey: string;
    epaTotal: number | null;
    epaAuto: number | null;
    epaTeleop: number | null;
  }>(
    `SELECT DISTINCT ON (m.team_key)
        m.team_key AS "teamKey",
        m.epa_total AS "epaTotal",
        m.epa_auto AS "epaAuto",
        m.epa_teleop AS "epaTeleop"
     FROM team_event_metrics m
     WHERE m.event_key = $1::text
     ORDER BY m.team_key,
       CASE m.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
       m.synced_at DESC NULLS LAST`,
    [eventKey],
  );

  const byTeam = new Map<number, { epaTotal: number | null; epaAuto: number | null; epaTeleop: number | null }>();
  const fieldTotals: number[] = [];
  for (const row of result.rows) {
    if (row.epaTotal != null && Number.isFinite(row.epaTotal)) fieldTotals.push(row.epaTotal);
    const teamNumber = teamNumberFromKey(row.teamKey);
    if (teamNumber == null) continue;
    byTeam.set(teamNumber, {
      epaTotal: row.epaTotal,
      epaAuto: row.epaAuto,
      epaTeleop: row.epaTeleop,
    });
  }
  return { byTeam, bench: fieldEpaBenchmarks(fieldTotals) };
}

function projectEntries(
  snapshot: PickListSnapshot,
  epa: Awaited<ReturnType<typeof loadEventEpa>>,
): PicklistCollabEntry[] {
  const entries: PicklistCollabEntry[] = [];
  for (const entry of snapshot.entries) {
    const teamNumber = entry.teamNumber ?? teamNumberFromKey(entry.teamKey);
    if (teamNumber == null) continue;
    const metrics = epa.byTeam.get(teamNumber) ?? null;
    const votes = entry.votes.map(toCollabVote);
    entries.push({
      id: entry.id,
      teamNumber,
      teamName: entry.nickname,
      tier: tierFromBucket(entry.bucket),
      position: entry.rank,
      note: entry.notes,
      addedBy: entry.addedBy ?? snapshot.list.createdBy,
      votes,
      weightedScore: entry.weightedScore,
      averageRankSuggestion: entry.averageRankSuggestion,
      epaTotal: metrics?.epaTotal ?? null,
      epaAuto: metrics?.epaAuto ?? null,
      epaTeleop: metrics?.epaTeleop ?? null,
      epaRole: classifyEpaRole({
        epaTotal: metrics?.epaTotal ?? null,
        epaAuto: metrics?.epaAuto ?? null,
        epaTeleop: metrics?.epaTeleop ?? null,
        fieldMedian: epa.bench?.median ?? null,
        fieldP75: epa.bench?.p75 ?? null,
      }),
    });
  }
  return entries;
}

export async function computePicklistCollabView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; listId?: string | null },
): Promise<PicklistCollabView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequired(null);

  const records = await listPickLists(client, { orgId: org.orgId });
  if (records.length === 0) {
    return {
      status: "setup_required",
      message: "Create your first pick list for an upcoming event.",
      steps: [
        {
          id: "create-list",
          label: "Create a pick list",
          detail:
            "Name it after your next event. The same list feeds the alliance-selection desk and Pick Clock.",
          href: "/picklist-collab",
        },
      ],
      orgId: org.orgId,
    };
  }

  const lists = records.map(toCollabList);
  const snapshot = await listPickList(client, {
    orgId: org.orgId,
    pickListId: input.listId ?? lists[0]!.id,
  });
  if (!snapshot) return setupRequired(org.orgId);

  const activeList = toCollabList(snapshot.list);
  const epa = await loadEventEpa(client, snapshot.list.eventKey);
  const entries = projectEntries(snapshot, epa);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    lists,
    activeList,
    entries: sortEntriesForDisplay(entries),
    summary: summarizePicklistCollab(entries),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----
// Every one of these now lands on the shared spine, so a change here is visible on the draft
// board, in Pick Clock, and to the justifier.

export async function createList(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; name: string; seasonYear: number },
): Promise<void> {
  try {
    await ensurePickList(client, {
      orgId: input.orgId,
      userId: input.userId,
      eventKey: input.eventKey,
      name: input.name,
      seasonYear: input.seasonYear,
      source: "picklist_collab",
    });
  } catch (error) {
    // pick_lists.event_key is FK'd to the TBA event reference — degrade to a "configure X" state.
    const message = error instanceof Error ? error.message : "";
    if (/foreign key|events_ref/i.test(message)) {
      throw new Error(
        `${input.eventKey} is not in the event reference yet — sync the event from Competition first.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function updateListStatus(
  client: PoolClient,
  input: { orgId: string; listId: string; status: PicklistCollabListStatus; userId?: string },
): Promise<void> {
  await setListStatus(client, {
    orgId: input.orgId,
    userId: input.userId ?? null,
    pickListId: input.listId,
    status: input.status,
  });
}

export async function addEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    listId: string;
    teamNumber: number;
    teamName: string | null;
    tier: PicklistCollabTier;
    note: string | null;
  },
): Promise<void> {
  await upsertEntry(client, {
    orgId: input.orgId,
    userId: input.userId,
    pickListId: input.listId,
    teamKey: input.teamNumber,
    bucket: bucketFromTier(input.tier),
    notes: input.note,
  });
}

/**
 * Tier change / drag. `position` is the 1-based slot the UI is holding, so it maps straight onto
 * the store's zero-based destination index. Last-write-wins; the conflict (if any) is surfaced by
 * the unified /api/picklist endpoint.
 */
export async function moveEntry(
  client: PoolClient,
  input: {
    orgId: string;
    entryId: string;
    tier: PicklistCollabTier;
    position: number;
    userId?: string;
    listId?: string | null;
    expectedRevision?: number | null;
  },
): Promise<void> {
  const listId = input.listId ?? (await pickListIdForEntry(client, input.orgId, input.entryId));
  if (!listId) throw new Error("Pick-list entry not found");
  await reorderEntry(client, {
    orgId: input.orgId,
    userId: input.userId ?? (await entryActor(client, input.orgId, input.entryId)),
    pickListId: listId,
    entryId: input.entryId,
    toIndex: Math.max(0, Math.trunc(input.position) - 1),
    bucket: bucketFromTier(input.tier),
    expectedRevision: input.expectedRevision ?? null,
  });
}

export async function deleteEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string; userId?: string; listId?: string | null },
): Promise<void> {
  const listId = input.listId ?? (await pickListIdForEntry(client, input.orgId, input.entryId));
  if (!listId) return;
  await deleteSpineEntry(client, {
    orgId: input.orgId,
    userId: input.userId ?? (await entryActor(client, input.orgId, input.entryId)),
    pickListId: listId,
    entryId: input.entryId,
  });
}

export async function castVote(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    entryId: string;
    weight: number;
    rankSuggestion: number | null;
    comment: string | null;
    listId?: string | null;
  },
): Promise<void> {
  const listId = input.listId ?? (await pickListIdForEntry(client, input.orgId, input.entryId));
  if (!listId) throw new Error("Pick-list entry not found");
  await recordVote(client, {
    orgId: input.orgId,
    userId: input.userId,
    pickListId: listId,
    entryId: input.entryId,
    weight: input.weight,
    rankSuggestion: input.rankSuggestion,
    comment: input.comment,
  });
}

export async function removeVote(
  client: PoolClient,
  input: { orgId: string; userId: string; entryId: string; listId?: string | null },
): Promise<void> {
  const listId = input.listId ?? (await pickListIdForEntry(client, input.orgId, input.entryId));
  if (!listId) return;
  await removeVoteFromSpine(client, {
    orgId: input.orgId,
    userId: input.userId,
    pickListId: listId,
    entryId: input.entryId,
  });
}

async function pickListIdForEntry(
  client: PoolClient,
  orgId: string,
  entryId: string,
): Promise<string | null> {
  const result = await client.query<{ pickListId: string }>(
    `SELECT pick_list_id AS "pickListId" FROM pick_list_entries
     WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, entryId],
  );
  return result.rows[0]?.pickListId ?? null;
}

/**
 * The acting user when a legacy caller did not pass one. `current_app_user_id()` is the identity
 * withRls already pinned on this connection, so "updated by X" names the real editor.
 */
async function entryActor(client: PoolClient, orgId: string, entryId: string): Promise<string> {
  const result = await client.query<{ actor: string | null }>(
    `SELECT COALESCE(current_app_user_id(), e.updated_by, e.added_by)::text AS actor
     FROM pick_list_entries e
     WHERE e.org_id = $1::uuid AND e.id = $2::uuid`,
    [orgId, entryId],
  );
  const actor = result.rows[0]?.actor;
  if (!actor) throw new Error("Pick-list entry not found");
  return actor;
}
