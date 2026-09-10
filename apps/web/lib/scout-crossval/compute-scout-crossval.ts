import type { PoolClient } from "@neondatabase/serverless";
import { computeFieldChecks, overallStatusFromFields, resolveAllianceColor, summarizeCrossval } from ".";
import type { CrossvalEntry, CrossvalFieldCheck, CrossvalFieldKey, CrossvalSummary } from "./types";
import { resolveScoutOrg } from "../scout-org-access";

export type ScoutCrossvalSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutCrossvalView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutCrossvalSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string | null;
      events: string[];
      entries: CrossvalEntry[];
      summary: CrossvalSummary;
      computedAt: string;
    };

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

type AllianceJson = { team_keys?: string[] } | string[] | null;

type EntryRow = {
  entryId: string;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  teamNumber: number | null;
  scoutUserId: string;
  payload: Record<string, unknown> | null;
  redAlliance: AllianceJson;
  blueAlliance: AllianceJson;
  scoreBreakdown: Record<string, unknown> | null;
  runId: string | null;
  runAllianceColor: "red" | "blue" | null;
  runOverallStatus: "agree" | "conflict" | "unverifiable" | null;
  runAgreeCount: number | null;
  runConflictCount: number | null;
  runUnverifiableCount: number | null;
  runComputedAt: string | null;
};

type FieldRow = {
  runId: string;
  fieldKey: CrossvalFieldKey;
  fieldLabel: string;
  scoutValue: number | null;
  officialValue: number | null;
  status: "agree" | "conflict" | "unverifiable";
  deltaAbs: number | null;
  deltaPct: number | null;
};

function toEntry(row: EntryRow, fields: CrossvalFieldCheck[]): CrossvalEntry {
  const allianceColor = row.runAllianceColor ?? resolveAllianceColor(row.teamKey, row.redAlliance, row.blueAlliance);
  const derived = row.runId
    ? {
        overallStatus: row.runOverallStatus ?? "unverifiable",
        agreeCount: row.runAgreeCount ?? 0,
        conflictCount: row.runConflictCount ?? 0,
        unverifiableCount: row.runUnverifiableCount ?? 0,
      }
    : overallStatusFromFields(fields);
  return {
    id: row.runId ?? row.entryId,
    matchScoutEntryId: row.entryId,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    scoutUserId: row.scoutUserId,
    allianceColor,
    overallStatus: derived.overallStatus,
    agreeCount: derived.agreeCount,
    conflictCount: derived.conflictCount,
    unverifiableCount: derived.unverifiableCount,
    fields,
    computedAt: row.runComputedAt ?? new Date().toISOString(),
  };
}

export async function computeScoutCrossvalView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; eventKey?: string | null },
): Promise<ScoutCrossvalView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to cross-validate scout entries against official results.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const eventsResult = await client.query<{ eventKey: string }>(
    `SELECT DISTINCT event_key AS "eventKey" FROM match_scout_entries WHERE org_id = $1 ORDER BY event_key DESC`,
    [org.orgId],
  );
  const events = eventsResult.rows.map((r) => r.eventKey);
  const eventKey = input.eventKey && events.includes(input.eventKey) ? input.eventKey : events[0] ?? null;

  if (!eventKey) {
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      eventKey: null,
      events,
      entries: [],
      summary: summarizeCrossval([]),
      computedAt: new Date().toISOString(),
    };
  }

  const entryResult = await client.query<EntryRow>(
    `SELECT mse.id AS "entryId", mse.event_key AS "eventKey", mse.match_key AS "matchKey",
            mse.team_key AS "teamKey", t.team_number AS "teamNumber", mse.scout_user_id AS "scoutUserId",
            mse.payload AS "payload", m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
            m.score_breakdown AS "scoreBreakdown",
            r.id AS "runId", r.alliance_color AS "runAllianceColor", r.overall_status AS "runOverallStatus",
            r.agree_count AS "runAgreeCount", r.conflict_count AS "runConflictCount",
            r.unverifiable_count AS "runUnverifiableCount", r.computed_at::text AS "runComputedAt"
     FROM match_scout_entries mse
     JOIN matches_ref m ON m.match_key = mse.match_key
     JOIN teams_ref t ON t.team_key = mse.team_key
     LEFT JOIN scout_crossval_runs r ON r.match_scout_entry_id = mse.id AND r.org_id = mse.org_id
     WHERE mse.org_id = $1 AND mse.event_key = $2
     ORDER BY mse.synced_at DESC
     LIMIT 150`,
    [org.orgId, eventKey],
  );

  const runIds = entryResult.rows.map((r) => r.runId).filter((id): id is string => id != null);
  const fieldsByRun = new Map<string, CrossvalFieldCheck[]>();
  if (runIds.length > 0) {
    const fieldResult = await client.query<FieldRow>(
      `SELECT run_id AS "runId", field_key AS "fieldKey", field_label AS "fieldLabel",
              scout_value AS "scoutValue", official_value AS "officialValue", status,
              delta_abs AS "deltaAbs", delta_pct AS "deltaPct"
       FROM scout_crossval_fields
       WHERE org_id = $1 AND run_id = ANY($2::uuid[])`,
      [org.orgId, runIds],
    );
    for (const field of fieldResult.rows) {
      const list = fieldsByRun.get(field.runId) ?? [];
      list.push({
        fieldKey: field.fieldKey,
        fieldLabel: field.fieldLabel,
        scoutValue: field.scoutValue,
        officialValue: field.officialValue,
        status: field.status,
        deltaAbs: field.deltaAbs,
        deltaPct: field.deltaPct,
      });
      fieldsByRun.set(field.runId, list);
    }
  }

  const entries = entryResult.rows.map((row) => {
    if (row.runId) {
      return toEntry(row, fieldsByRun.get(row.runId) ?? []);
    }
    const allianceColor = resolveAllianceColor(row.teamKey, row.redAlliance, row.blueAlliance);
    const fields = computeFieldChecks({
      payload: row.payload,
      scoreBreakdown: row.scoreBreakdown,
      allianceColor,
    });
    return toEntry(row, fields);
  });

  const summary = summarizeCrossval(entries);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey,
    events,
    entries,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Computes and persists a cross-validation run for one match-scout entry against the cached
 * official score breakdown. Intended to be triggered right after a scout entry is saved.
 */
export async function runCrossvalForEntry(
  client: PoolClient,
  input: { orgId: string; userId: string; matchScoutEntryId: string },
): Promise<CrossvalEntry | null> {
  const entryResult = await client.query<{
    entryId: string;
    eventKey: string;
    matchKey: string;
    teamKey: string;
    teamNumber: number | null;
    scoutUserId: string;
    payload: Record<string, unknown> | null;
    redAlliance: AllianceJson;
    blueAlliance: AllianceJson;
    scoreBreakdown: Record<string, unknown> | null;
  }>(
    `SELECT mse.id AS "entryId", mse.event_key AS "eventKey", mse.match_key AS "matchKey",
            mse.team_key AS "teamKey", t.team_number AS "teamNumber", mse.scout_user_id AS "scoutUserId",
            mse.payload AS "payload", m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
            m.score_breakdown AS "scoreBreakdown"
     FROM match_scout_entries mse
     JOIN matches_ref m ON m.match_key = mse.match_key
     JOIN teams_ref t ON t.team_key = mse.team_key
     WHERE mse.org_id = $1 AND mse.id = $2`,
    [input.orgId, input.matchScoutEntryId],
  );
  const row = entryResult.rows[0];
  if (!row) return null;

  const allianceColor = resolveAllianceColor(row.teamKey, row.redAlliance, row.blueAlliance);
  const fields = computeFieldChecks({ payload: row.payload, scoreBreakdown: row.scoreBreakdown, allianceColor });
  const { overallStatus, agreeCount, conflictCount, unverifiableCount } = overallStatusFromFields(fields);

  const runResult = await client.query<{ id: string; computedAt: string }>(
    `INSERT INTO scout_crossval_runs (
       org_id, match_scout_entry_id, event_key, match_key, team_key, alliance_color,
       overall_status, agree_count, conflict_count, unverifiable_count, computed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (org_id, match_scout_entry_id) DO UPDATE SET
       alliance_color = EXCLUDED.alliance_color,
       overall_status = EXCLUDED.overall_status,
       agree_count = EXCLUDED.agree_count,
       conflict_count = EXCLUDED.conflict_count,
       unverifiable_count = EXCLUDED.unverifiable_count,
       computed_by = EXCLUDED.computed_by,
       computed_at = now()
     RETURNING id, computed_at::text AS "computedAt"`,
    [
      input.orgId,
      row.entryId,
      row.eventKey,
      row.matchKey,
      row.teamKey,
      allianceColor,
      overallStatus,
      agreeCount,
      conflictCount,
      unverifiableCount,
      input.userId,
    ],
  );
  const runRow = runResult.rows[0];
  if (!runRow) throw new Error("Failed to persist cross-validation run");
  const runId = runRow.id;
  const computedAt = runRow.computedAt;

  await client.query(`DELETE FROM scout_crossval_fields WHERE org_id = $1 AND run_id = $2`, [input.orgId, runId]);
  for (const field of fields) {
    await client.query(
      `INSERT INTO scout_crossval_fields (
         org_id, run_id, field_key, field_label, scout_value, official_value, status, delta_abs, delta_pct
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.orgId,
        runId,
        field.fieldKey,
        field.fieldLabel,
        field.scoutValue,
        field.officialValue,
        field.status,
        field.deltaAbs,
        field.deltaPct,
      ],
    );
  }

  return {
    id: runId,
    matchScoutEntryId: row.entryId,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    scoutUserId: row.scoutUserId,
    allianceColor,
    overallStatus,
    agreeCount,
    conflictCount,
    unverifiableCount,
    fields,
    computedAt,
  };
}
