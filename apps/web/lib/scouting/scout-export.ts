/**
 * Every match scouting report at one event, as a spreadsheet a lead can open.
 *
 * The Saved entries button used to download the 30 newest reports with only
 * Match / Team / Scout / Source columns and raw keys ("2026gacmp_qm1",
 * "frc195"); none of the answers the scouts recorded were in it. This is the
 * whole event, one row per report in match order, one column per form
 * question under the question's own label.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { isLayoutOnlyField, type FieldDefinition } from "@vantage/scouting";
import { matchLabelFromKey } from "../matches/no-next-match";
import { scoutOptionLabel } from "./option-label";

export type ScoutExportRow = {
  matchKey: string;
  teamKey: string;
  scoutName: string | null;
  confidence: string | null;
  payload: Record<string, unknown>;
  savedAt: string | null;
};

export type ScoutExportField = Pick<FieldDefinition, "key" | "label" | "type">;

const CONFIDENCE: Record<string, string> = { low: "Not sure", normal: "Fairly sure", high: "Very sure" };

function cell(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  // A cell that starts with = + - @ is a formula to a spreadsheet; text never runs.
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function scoutAnswerText(value: unknown): string | number {
  if (value == null || value === "") return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return scoutOptionLabel(value);
  if (Array.isArray(value)) return value.map((item) => String(scoutAnswerText(item))).filter(Boolean).join("; ");
  return JSON.stringify(value);
}

/** Question columns: the form's order, then any answer the form no longer asks. */
export function exportColumns(fields: readonly ScoutExportField[], rows: readonly ScoutExportRow[]): ScoutExportField[] {
  const columns = fields.filter((field) => !isLayoutOnlyField(field));
  const known = new Set(columns.map((field) => field.key));
  const extra = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.payload ?? {})) {
      if (!known.has(key) && !key.startsWith("_")) extra.add(key);
    }
  }
  return [
    ...columns,
    ...[...extra].sort().map((key) => ({ key, label: key, type: "text" as FieldDefinition["type"] })),
  ];
}

export function matchScoutingCsv(input: { fields: readonly ScoutExportField[]; rows: readonly ScoutExportRow[] }): string {
  const columns = exportColumns(input.fields, input.rows);
  const header = ["Match", "Team", "Scout", ...columns.map((field) => field.label || field.key), "How sure", "Saved at"];
  const lines = [header.map((value) => cell(value)).join(",")];
  for (const row of input.rows) {
    lines.push(
      [
        matchLabelFromKey(row.matchKey),
        row.teamKey.replace(/^frc/i, ""),
        row.scoutName?.trim() || "Team scout",
        ...columns.map((field) => scoutAnswerText(row.payload?.[field.key])),
        row.confidence ? (CONFIDENCE[row.confidence] ?? row.confidence) : "",
        row.savedAt ?? "",
      ]
        .map((value) => cell(value))
        .join(","),
    );
  }
  // Byte-order mark so Excel opens names with accents correctly.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Every report at the event, in match order (Qual 2 before Qual 10), then robot, then save time. */
export async function loadMatchScoutingExport(
  client: PoolClient,
  input: { orgId: string; eventKey: string },
): Promise<{ fields: ScoutExportField[]; rows: ScoutExportRow[] }> {
  const entries = await client.query<ScoutExportRow & { schemaId: string }>(
    `SELECT e.match_key AS "matchKey", e.team_key AS "teamKey",
            COALESCE(NULLIF(p.display_name, ''), NULLIF(u.name, '')) AS "scoutName",
            e.confidence::text AS confidence, e.payload,
            to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') AS "savedAt",
            e.schema_id::text AS "schemaId"
       FROM match_scout_entries e
       LEFT JOIN matches_ref m ON m.match_key = e.match_key
       LEFT JOIN users u ON u.id = e.scout_user_id
       LEFT JOIN profiles p ON p.user_id = e.scout_user_id
      WHERE e.org_id = $1::uuid AND e.event_key = $2::text
      ORDER BY CASE m.comp_level WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5 END,
               m.set_number NULLS LAST, m.match_number NULLS LAST, e.match_key,
               e.team_key, e.created_at, e.id`,
    [input.orgId, input.eventKey],
  );
  const schemaIds = [...new Set(entries.rows.map((row) => row.schemaId))];
  const fields: ScoutExportField[] = [];
  if (schemaIds.length) {
    // Newest form first, so its labels and order win; older versions add only
    // questions the newest one dropped.
    const schemas = await client.query<{ definition: { fields?: ScoutExportField[] } | null }>(
      `SELECT schema AS definition FROM scout_schemas
        WHERE org_id = $1::uuid AND id = ANY($2::uuid[])
        ORDER BY version DESC, created_at DESC`,
      [input.orgId, schemaIds],
    );
    const seen = new Set<string>();
    for (const schema of schemas.rows) {
      for (const field of schema.definition?.fields ?? []) {
        if (!field?.key || seen.has(field.key)) continue;
        seen.add(field.key);
        fields.push({ key: field.key, label: field.label, type: field.type });
      }
    }
  }
  return {
    fields,
    rows: entries.rows.map(({ schemaId: _schemaId, ...row }) => ({ ...row, payload: row.payload ?? {} })),
  };
}
