import type { PoolClient } from "@neondatabase/serverless";
import { averageRankSuggestion, sortEntriesForDisplay, summarizePicklistCollab, weightedScore } from ".";
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

type ListRow = {
  id: string;
  eventKey: string;
  name: string;
  seasonYear: number;
  status: PicklistCollabListStatus;
  createdBy: string;
  updatedAt: string;
};

function mapList(row: ListRow): PicklistCollabList {
  return {
    id: row.id,
    eventKey: row.eventKey,
    name: row.name,
    seasonYear: row.seasonYear,
    status: row.status,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  };
}

type EntryRow = {
  id: string;
  teamNumber: number;
  teamName: string | null;
  tier: PicklistCollabTier;
  position: number;
  note: string | null;
  addedBy: string;
};

type VoteRow = {
  id: string;
  entryId: string;
  voterId: string;
  weight: string | number;
  rankSuggestion: number | null;
  comment: string | null;
  updatedAt: string;
};

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
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

export async function computePicklistCollabView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; listId?: string | null },
): Promise<PicklistCollabView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequired(null);

  const listResult = await client.query<ListRow>(
    `SELECT id, event_key AS "eventKey", name, season_year AS "seasonYear", status,
            created_by AS "createdBy", updated_at::text AS "updatedAt"
     FROM picklist_collab_lists
     WHERE org_id = $1
     ORDER BY updated_at DESC`,
    [org.orgId],
  );
  const lists = listResult.rows.map(mapList);

  if (lists.length === 0) {
    return {
      status: "setup_required",
      message: "Create your first collaborative pick list for an upcoming event.",
      steps: [
        {
          id: "create-list",
          label: "Create a pick list",
          detail: "Name it after your next event so the team can start ranking and voting",
          href: "/picklist-collab",
        },
      ],
      orgId: org.orgId,
    };
  }

  const activeList: PicklistCollabList =
    (input.listId ? lists.find((l) => l.id === input.listId) : undefined) ?? lists[0]!;

  const [entryResult, voteResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT id, team_number AS "teamNumber", team_name AS "teamName", tier, position, note,
              added_by AS "addedBy"
       FROM picklist_collab_entries
       WHERE org_id = $1 AND list_id = $2
       ORDER BY tier, position, team_number`,
      [org.orgId, activeList.id],
    ),
    client.query<VoteRow>(
      `SELECT v.id, v.entry_id AS "entryId", v.voter_id AS "voterId", v.weight,
              v.rank_suggestion AS "rankSuggestion", v.comment, v.updated_at::text AS "updatedAt"
       FROM picklist_collab_votes v
       JOIN picklist_collab_entries e ON e.id = v.entry_id
       WHERE v.org_id = $1 AND e.list_id = $2`,
      [org.orgId, activeList.id],
    ),
  ]);

  const votesByEntry = new Map<string, PicklistCollabVote[]>();
  for (const row of voteResult.rows) {
    const vote: PicklistCollabVote = {
      id: row.id,
      voterId: row.voterId,
      weight: Number(row.weight) || 0,
      rankSuggestion: row.rankSuggestion == null ? null : Number(row.rankSuggestion),
      comment: row.comment,
      updatedAt: row.updatedAt,
    };
    const list = votesByEntry.get(row.entryId) ?? [];
    list.push(vote);
    votesByEntry.set(row.entryId, list);
  }

  const entries: PicklistCollabEntry[] = entryResult.rows.map((row) => {
    const votes = votesByEntry.get(row.id) ?? [];
    return {
      id: row.id,
      teamNumber: row.teamNumber,
      teamName: row.teamName,
      tier: row.tier,
      position: row.position,
      note: row.note,
      addedBy: row.addedBy,
      votes,
      weightedScore: weightedScore(votes),
      averageRankSuggestion: averageRankSuggestion(votes),
    };
  });

  const sortedEntries = sortEntriesForDisplay(entries);
  const summary = summarizePicklistCollab(entries);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    lists,
    activeList,
    entries: sortedEntries,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createList(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; name: string; seasonYear: number },
): Promise<void> {
  await client.query(
    `INSERT INTO picklist_collab_lists (org_id, event_key, name, season_year, created_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.orgId, input.eventKey, input.name, input.seasonYear, input.userId],
  );
}

export async function updateListStatus(
  client: PoolClient,
  input: { orgId: string; listId: string; status: PicklistCollabListStatus },
): Promise<void> {
  await client.query(
    `UPDATE picklist_collab_lists SET status = $3, updated_at = now() WHERE org_id = $1 AND id = $2`,
    [input.orgId, input.listId, input.status],
  );
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
  const positionResult = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM picklist_collab_entries WHERE list_id = $1 AND tier = $2`,
    [input.listId, input.tier],
  );
  const position = positionResult.rows[0]?.next ?? 1;
  await client.query(
    `INSERT INTO picklist_collab_entries (org_id, list_id, team_number, team_name, tier, position, note, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (list_id, team_number) DO UPDATE SET
       team_name = EXCLUDED.team_name, tier = EXCLUDED.tier, note = EXCLUDED.note, updated_at = now()`,
    [input.orgId, input.listId, input.teamNumber, input.teamName, input.tier, position, input.note, input.userId],
  );
}

export async function moveEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string; tier: PicklistCollabTier; position: number },
): Promise<void> {
  await client.query(
    `UPDATE picklist_collab_entries SET tier = $3, position = $4, updated_at = now()
     WHERE org_id = $1 AND id = $2`,
    [input.orgId, input.entryId, input.tier, input.position],
  );
}

export async function deleteEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM picklist_collab_entries WHERE org_id = $1 AND id = $2`, [
    input.orgId,
    input.entryId,
  ]);
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
  },
): Promise<void> {
  await client.query(
    `INSERT INTO picklist_collab_votes (org_id, entry_id, voter_id, weight, rank_suggestion, comment)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (entry_id, voter_id) DO UPDATE SET
       weight = EXCLUDED.weight, rank_suggestion = EXCLUDED.rank_suggestion,
       comment = EXCLUDED.comment, updated_at = now()`,
    [input.orgId, input.entryId, input.userId, input.weight, input.rankSuggestion, input.comment],
  );
}

export async function removeVote(
  client: PoolClient,
  input: { orgId: string; userId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM picklist_collab_votes WHERE org_id = $1 AND entry_id = $2 AND voter_id = $3`, [
    input.orgId,
    input.entryId,
    input.userId,
  ]);
}
