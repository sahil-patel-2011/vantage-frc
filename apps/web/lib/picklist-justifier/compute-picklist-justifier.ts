import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { averageConfidence, computeJustification } from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type {
  JustificationInput,
  JustifiedEntry,
  PickListSummary,
  PicklistJustifierSetupStep,
  PicklistJustifierView,
} from "./types";

export type { PicklistJustifierView } from "./types";

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string } | null> {
  const membership = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
     FROM memberships m
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO pick rationales. */
function setupSteps(orgId: string | null): PicklistJustifierSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Pick-list Justifier is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "strategy",
      label: "Build a pick list",
      detail: "Create a ranked pick list under Strategy — never DEMO rankings.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout rows stay blank until your team enters them — never DEMO scores.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

function setupRequiredView(message: string, orgId: string | null = null): PicklistJustifierView {
  return {
    status: "setup_required",
    message,
    steps: setupSteps(orgId),
    orgId,
  };
}

type EntryRow = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  rank: number;
  tier: string | null;
  notes: string | null;
};

type TbaRow = {
  teamKey: string;
  epaTotal: number | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  source: string;
};

type ScoutRow = { teamKey: string; confidence: string };

type SavedRow = {
  pickListEntryId: string;
  rationale: string;
  sources: unknown;
  contradictionFlagged: boolean;
  contradictionReason: string | null;
  createdAt: string;
};

async function loadPickLists(client: PoolClient, orgId: string): Promise<PickListSummary[]> {
  const result = await client.query<{
    id: string;
    name: string;
    eventKey: string;
    entryCount: string;
    updatedAt: string;
  }>(
    `SELECT pl.id, pl.name, pl.event_key AS "eventKey", pl.updated_at::text AS "updatedAt",
            COUNT(pe.id)::text AS "entryCount"
     FROM pick_lists pl
     LEFT JOIN pick_list_entries pe ON pe.pick_list_id = pl.id
     WHERE pl.org_id = $1
     GROUP BY pl.id
     ORDER BY pl.updated_at DESC`,
    [orgId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    eventKey: row.eventKey,
    entryCount: Number(row.entryCount) || 0,
    updatedAt: row.updatedAt,
  }));
}

/** Loads each pick-list slot's team + its TBA hard metrics + this org's scout summary. Pure DB read, no AI. */
async function loadJustificationInputs(
  client: PoolClient,
  input: { orgId: string; pickListId: string; eventKey: string },
): Promise<Array<{ entryId: string; notes: string | null; input: JustificationInput }>> {
  const entryResult = await client.query<EntryRow>(
    `SELECT pe.id, pe.team_key AS "teamKey", t.team_number AS "teamNumber", pe.rank, pe.tier, pe.notes
     FROM pick_list_entries pe
     LEFT JOIN teams_ref t ON t.team_key = pe.team_key
     WHERE pe.pick_list_id = $1 AND pe.org_id = $2
     ORDER BY pe.rank`,
    [input.pickListId, input.orgId],
  );
  const entries = entryResult.rows;
  if (!entries.length) return [];
  const teamKeys = entries.map((e) => e.teamKey);

  const [tbaResult, scoutResult] = await Promise.all([
    client.query<TbaRow>(
      `SELECT DISTINCT ON (team_key) team_key AS "teamKey", epa_total AS "epaTotal", rank,
              wins, losses, ties, source
       FROM team_event_metrics
       WHERE event_key = $1 AND team_key = ANY($2::text[])
       ORDER BY team_key, (source = 'tba') DESC, synced_at DESC`,
      [input.eventKey, teamKeys],
    ),
    client.query<ScoutRow>(
      `SELECT team_key AS "teamKey", confidence::text AS confidence
       FROM match_scout_entries
       WHERE org_id = $1 AND event_key = $2 AND team_key = ANY($3::text[])`,
      [input.orgId, input.eventKey, teamKeys],
    ),
  ]);

  const tbaByTeam = new Map<string, TbaRow>();
  for (const row of tbaResult.rows) tbaByTeam.set(row.teamKey, row);
  const scoutByTeam = new Map<string, string[]>();
  for (const row of scoutResult.rows) {
    const list = scoutByTeam.get(row.teamKey) ?? [];
    list.push(row.confidence);
    scoutByTeam.set(row.teamKey, list);
  }

  return entries.map((entry) => {
    const tbaRow = tbaByTeam.get(entry.teamKey) ?? null;
    const confidences = scoutByTeam.get(entry.teamKey) ?? [];
    return {
      entryId: entry.id,
      notes: entry.notes,
      input: {
        teamKey: entry.teamKey,
        teamNumber: entry.teamNumber,
        rank: entry.rank,
        tier: entry.tier,
        tba: tbaRow
          ? {
              epaTotal: tbaRow.epaTotal,
              rank: tbaRow.rank,
              wins: Number(tbaRow.wins) || 0,
              losses: Number(tbaRow.losses) || 0,
              ties: Number(tbaRow.ties) || 0,
              source: tbaRow.source,
            }
          : null,
        scout: {
          entryCount: confidences.length,
          avgConfidenceScore: averageConfidence(confidences),
          lowConfidenceCount: confidences.filter((c) => c === "low").length,
        },
      },
    };
  });
}

export async function computePicklistJustifierView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; pickListId?: string | null },
): Promise<PicklistJustifierView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return setupRequiredView("Select a team workspace to justify pick-list slots.");
  }

  const pickLists = await loadPickLists(client, org.orgId);
  if (!pickLists.length) {
    return {
      status: "live",
      orgId: org.orgId,
      pickLists: [],
      selectedPickListId: null,
      eventKey: null,
      entries: [],
      contradictionCount: 0,
      computedAt: new Date().toISOString(),
    };
  }

  const selected = (input.pickListId && pickLists.find((pl) => pl.id === input.pickListId)) || pickLists[0]!;

  const [justificationInputs, savedResult] = await Promise.all([
    loadJustificationInputs(client, { orgId: org.orgId, pickListId: selected.id, eventKey: selected.eventKey }),
    client.query<SavedRow>(
      `SELECT pick_list_entry_id AS "pickListEntryId", rationale, sources,
              contradiction_flagged AS "contradictionFlagged", contradiction_reason AS "contradictionReason",
              created_at::text AS "createdAt"
       FROM picklist_justifier_justifications
       WHERE org_id = $1 AND pick_list_id = $2`,
      [org.orgId, selected.id],
    ),
  ]);

  const savedByEntry = new Map<string, SavedRow>();
  for (const row of savedResult.rows) savedByEntry.set(row.pickListEntryId, row);

  const entries: JustifiedEntry[] = justificationInputs.map(({ entryId, notes, input: ji }) => {
    const saved = savedByEntry.get(entryId);
    return {
      id: entryId,
      teamKey: ji.teamKey,
      teamNumber: ji.teamNumber,
      rank: ji.rank,
      tier: ji.tier,
      notes,
      scoutEntryCount: ji.scout.entryCount,
      tbaAvailable: ji.tba != null,
      rationale: saved?.rationale ?? null,
      sources: Array.isArray(saved?.sources) ? (saved!.sources as JustifiedEntry["sources"]) : [],
      contradiction: saved ? { flagged: saved.contradictionFlagged, reason: saved.contradictionReason } : null,
      generatedAt: saved?.createdAt ?? null,
    };
  });

  return {
    status: "live",
    orgId: org.orgId,
    pickLists,
    selectedPickListId: selected.id,
    eventKey: selected.eventKey,
    entries,
    contradictionCount: entries.filter((e) => e.contradiction?.flagged).length,
    computedAt: new Date().toISOString(),
  };
}

/** Metered: computes fresh, source-cited justifications for every slot in a pick list and upserts them. */
export async function generatePicklistJustifications(
  client: PoolClient,
  input: { orgId: string; userId: string; pickListId: string },
): Promise<PicklistJustifierView> {
  const pickListResult = await client.query<{ id: string; eventKey: string }>(
    `SELECT id, event_key AS "eventKey" FROM pick_lists WHERE id = $1 AND org_id = $2`,
    [input.pickListId, input.orgId],
  );
  const pickList = pickListResult.rows[0];
  if (!pickList) throw new Error("Pick list not found");

  const justificationInputs = await loadJustificationInputs(client, {
    orgId: input.orgId,
    pickListId: pickList.id,
    eventKey: pickList.eventKey,
  });
  if (!justificationInputs.length) throw new Error("This pick list has no entries yet");

  const requestId = `picklist-justifier-${randomUUID()}`;

  const results = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "picklist-justifier",
    requestId,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      pickListId: pickList.id,
      eventKey: pickList.eventKey,
      slotCount: justificationInputs.length,
      note: "Deterministic source-cited rationale synthesis — no external model charge",
    },
    invoke: async () => {
      const value = justificationInputs.map(({ entryId, input: ji }) => ({
        entryId,
        teamKey: ji.teamKey,
        ...computeJustification(ji),
      }));
      return {
        value,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-picklist-justifier-v1",
        provider: "vantage-local",
      };
    },
  });

  for (const result of results) {
    await client.query(
      `INSERT INTO picklist_justifier_justifications
         (org_id, pick_list_id, pick_list_entry_id, team_key, rationale, sources,
          contradiction_flagged, contradiction_reason, ai_request_id, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       ON CONFLICT (pick_list_entry_id) DO UPDATE SET
         rationale = excluded.rationale,
         sources = excluded.sources,
         contradiction_flagged = excluded.contradiction_flagged,
         contradiction_reason = excluded.contradiction_reason,
         ai_request_id = excluded.ai_request_id,
         generated_by = excluded.generated_by,
         updated_at = now()`,
      [
        input.orgId,
        pickList.id,
        result.entryId,
        result.teamKey,
        result.rationale,
        JSON.stringify(result.sources),
        result.contradiction.flagged,
        result.contradiction.reason,
        requestId,
        input.userId,
      ],
    );
  }

  return computePicklistJustifierView(client, {
    userId: input.userId,
    requestedOrg: input.orgId,
    pickListId: pickList.id,
  });
}
