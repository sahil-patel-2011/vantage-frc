import type { PoolClient } from "@neondatabase/serverless";
import {
  conflictCountByTeam,
  stripContradictedFields,
  type ScoutFieldValidation,
} from "@vantage/scouting/trust";

export type { ScoutFieldValidation };

export async function loadEntryValidations(
  client: PoolClient,
  orgId: string,
  entryIds: string[],
): Promise<ScoutFieldValidation[]> {
  if (!entryIds.length) return [];
  const result = await client.query<{
    entryId: string;
    fieldKey: string;
    status: ScoutFieldValidation["status"];
    scoutValue: unknown;
    officialValue: unknown;
    officialSource: string;
    detail: string;
  }>(
    `SELECT entry_id AS "entryId", field_key AS "fieldKey", status,
            scout_value AS "scoutValue", official_value AS "officialValue",
            official_source AS "officialSource", detail
     FROM scout_entry_validations
     WHERE org_id = $1 AND entry_id = ANY($2::uuid[])
     ORDER BY checked_at DESC`,
    [orgId, entryIds],
  );
  return result.rows;
}

export async function loadEventValidationConflicts(
  client: PoolClient,
  orgId: string,
  eventKey: string,
  teamKeys: string[],
): Promise<Array<{ teamKey: string; fieldKey: string; status: ScoutFieldValidation["status"] }>> {
  if (!teamKeys.length) return [];
  const result = await client.query<{
    teamKey: string;
    fieldKey: string;
    status: ScoutFieldValidation["status"];
  }>(
    `SELECT e.team_key AS "teamKey", v.field_key AS "fieldKey", v.status
     FROM scout_entry_validations v
     JOIN match_scout_entries e ON e.id = v.entry_id
     WHERE v.org_id = $1 AND e.event_key = $2 AND e.team_key = ANY($3::text[])
       AND v.status = 'conflict'`,
    [orgId, eventKey, teamKeys],
  );
  return result.rows;
}

/** Apply TBA conflict strips to match-scout payloads; returns trusted payloads + excluded keys. */
export function trustScoutPayloads(
  entries: Array<{ id: string; payload: Record<string, unknown> }>,
  validations: ScoutFieldValidation[],
): Map<string, { trustedPayload: Record<string, unknown>; excludedFields: string[] }> {
  const byEntry = new Map<string, ScoutFieldValidation[]>();
  for (const row of validations) {
    const list = byEntry.get(row.entryId) ?? [];
    list.push(row);
    byEntry.set(row.entryId, list);
  }
  const trusted = new Map<string, { trustedPayload: Record<string, unknown>; excludedFields: string[] }>();
  for (const entry of entries) {
    trusted.set(entry.id, stripContradictedFields(entry.payload ?? {}, byEntry.get(entry.id) ?? []));
  }
  return trusted;
}

export { conflictCountByTeam, stripContradictedFields };
