// Scout form studio — server helpers shared by the drafts / templates / schemas routes.
//
// Request-path only: every query runs through the PoolClient handed out by withRls and is
// org-scoped in addition to RLS (migration 0496). Nothing here fabricates a definition:
// built-in starters come straight from packages/game-year, and a missing draft is null.

import type { PoolClient } from "@neondatabase/serverless";
import { currentSeasonYear } from "@vantage/game-year";
import {
  DEFAULT_MATCH_SCHEMA,
  DEFAULT_PIT_SCHEMA,
  answerableFields,
  matchSchemaForYear,
  pitSchemaForYear,
  type EntryType,
  type SchemaDefinition,
} from "@vantage/scouting";
import { stripScoutIdentityFields } from "@vantage/scouting/identity";

export const FORM_KINDS: readonly EntryType[] = ["match", "pit"];
export const MIN_SEASON_YEAR = 1992;
export const MAX_SEASON_YEAR = 2100;
export const MAX_DRAFT_FIELDS = 200;

export type FormDraftRow = {
  id: string;
  orgId: string;
  formKind: EntryType;
  seasonYear: number;
  title: string;
  definition: SchemaDefinition;
  baseSchemaId: string | null;
  updatedBy: string;
  updatedByName: string | null;
  updatedAt: string;
};

export type FormTemplateRow = {
  id: string;
  orgId: string;
  name: string;
  description: string;
  formKind: EntryType;
  sourceYear: number | null;
  definition: SchemaDefinition;
  fieldCount: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  builtIn: false;
};

/** A packages/game-year default surfaced as a "Start from…" option. Never stored. */
export type StarterTemplate = {
  id: string;
  name: string;
  description: string;
  formKind: EntryType;
  sourceYear: number | null;
  definition: SchemaDefinition;
  fieldCount: number;
  builtIn: true;
};

export function isFormKind(value: unknown): value is EntryType {
  return typeof value === "string" && (FORM_KINDS as readonly string[]).includes(value);
}

export function isSeasonYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_SEASON_YEAR && value <= MAX_SEASON_YEAR;
}

/** Narrow an untrusted body into a definition the studio can store; null when unusable. */
export function normalizeDraftDefinition(raw: unknown): SchemaDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as { title?: unknown; fields?: unknown };
  if (!Array.isArray(record.fields) || record.fields.length > MAX_DRAFT_FIELDS) return null;
  const fields = record.fields.filter(
    (field): field is SchemaDefinition["fields"][number] =>
      Boolean(field) &&
      typeof field === "object" &&
      typeof (field as { key?: unknown }).key === "string" &&
      typeof (field as { type?: unknown }).type === "string",
  );
  if (fields.length !== record.fields.length) return null;
  const title = typeof record.title === "string" ? record.title.slice(0, 120) : "";
  return stripScoutIdentityFields({ title, fields }).definition;
}

export function fieldCountOf(definition: SchemaDefinition): number {
  return answerableFields(definition).length;
}

/**
 * The season the studio authors for: the active event's year when one is set, else the
 * FRC season year (August starts next-season planning) so offseason authoring works.
 */
export async function resolveStudioYear(
  client: PoolClient,
  orgId: string,
): Promise<{ eventKey: string | null; year: number; yearSource: "event" | "season" }> {
  const context = await client.query<{ eventKey: string | null; year: number | null }>(
    `SELECT c.active_event_key AS "eventKey", e.year
     FROM org_active_context c
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE c.org_id = $1::uuid`,
    [orgId],
  );
  const row = context.rows[0];
  if (row?.year) return { eventKey: row.eventKey, year: Number(row.year), yearSource: "event" };
  return { eventKey: row?.eventKey ?? null, year: currentSeasonYear(), yearSource: "season" };
}

export async function assertCoach(client: PoolClient, orgId: string): Promise<void> {
  const allowed = await client.query<{ allowed: boolean }>(
    `SELECT has_org_role($1::uuid, ARRAY['owner','admin']::org_role[]) AS allowed`,
    [orgId],
  );
  if (!allowed.rows[0]?.allowed) throw new Error("Coach role required");
}

const DRAFT_COLUMNS = `
  d.id, d.org_id AS "orgId", d.form_kind::text AS "formKind", d.season_year AS "seasonYear",
  d.title, d.definition, d.base_schema_id AS "baseSchemaId", d.updated_by AS "updatedBy",
  u.name AS "updatedByName", d.updated_at::text AS "updatedAt"`;

export async function loadFormDrafts(
  client: PoolClient,
  input: { orgId: string; seasonYear?: number | null; formKind?: EntryType | null },
): Promise<FormDraftRow[]> {
  const result = await client.query<FormDraftRow>(
    `SELECT ${DRAFT_COLUMNS}
     FROM scout_form_drafts d
     LEFT JOIN users u ON u.id = d.updated_by
     WHERE d.org_id = $1::uuid
       AND ($2::int IS NULL OR d.season_year = $2::int)
       AND ($3::text IS NULL OR d.form_kind::text = $3::text)
     ORDER BY d.season_year DESC, d.form_kind`,
    [input.orgId, input.seasonYear ?? null, input.formKind ?? null],
  );
  return result.rows;
}

/** Upsert the ONE draft for (org, season, kind). Returns the stored row. */
export async function saveFormDraft(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    formKind: EntryType;
    seasonYear: number;
    title: string;
    definition: SchemaDefinition;
    baseSchemaId?: string | null;
  },
): Promise<FormDraftRow> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO scout_form_drafts
       (org_id, form_kind, season_year, title, definition, base_schema_id, updated_by)
     VALUES ($1::uuid, $2::scout_schema_type, $3::int, $4::text, $5::jsonb, $6::uuid, $7::uuid)
     ON CONFLICT (org_id, season_year, form_kind) DO UPDATE SET
       title = EXCLUDED.title,
       definition = EXCLUDED.definition,
       base_schema_id = COALESCE(EXCLUDED.base_schema_id, scout_form_drafts.base_schema_id),
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING id`,
    [
      input.orgId,
      input.formKind,
      input.seasonYear,
      input.title.slice(0, 120),
      JSON.stringify(input.definition),
      input.baseSchemaId ?? null,
      input.userId,
    ],
  );
  const id = result.rows[0]!.id;
  const rows = await client.query<FormDraftRow>(
    `SELECT ${DRAFT_COLUMNS} FROM scout_form_drafts d LEFT JOIN users u ON u.id = d.updated_by
     WHERE d.org_id = $1::uuid AND d.id = $2::uuid`,
    [input.orgId, id],
  );
  return rows.rows[0]!;
}

export async function deleteFormDraft(
  client: PoolClient,
  input: { orgId: string; formKind: EntryType; seasonYear: number },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM scout_form_drafts
     WHERE org_id = $1::uuid AND form_kind = $2::scout_schema_type AND season_year = $3::int`,
    [input.orgId, input.formKind, input.seasonYear],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Newest published schema of `formKind` from any season before `year` (last season when it exists). */
export async function loadPreviousSeasonSchema(
  client: PoolClient,
  input: { orgId: string; formKind: EntryType; year: number },
): Promise<{ id: string; year: number; version: number; definition: SchemaDefinition } | null> {
  const result = await client.query<{ id: string; year: number; version: number; definition: SchemaDefinition }>(
    `SELECT id, year, version, schema AS definition
     FROM scout_schemas
     WHERE org_id = $1::uuid AND type = $2::scout_schema_type AND year < $3::int
     ORDER BY year DESC, version DESC
     LIMIT 1`,
    [input.orgId, input.formKind, input.year],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, definition: stripScoutIdentityFields(row.definition).definition };
}

const TEMPLATE_COLUMNS = `
  t.id, t.org_id AS "orgId", t.name, t.description, t.form_kind::text AS "formKind",
  t.source_year AS "sourceYear", t.definition, t.field_count AS "fieldCount",
  t.created_by AS "createdBy", u.name AS "createdByName",
  t.created_at::text AS "createdAt", t.updated_at::text AS "updatedAt"`;

export async function loadFormTemplates(client: PoolClient, orgId: string): Promise<FormTemplateRow[]> {
  const result = await client.query<Omit<FormTemplateRow, "builtIn">>(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM scout_form_templates t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.org_id = $1::uuid
     ORDER BY t.form_kind, lower(t.name)`,
    [orgId],
  );
  return result.rows.map((row) => ({ ...row, builtIn: false as const }));
}

export async function loadFormTemplate(
  client: PoolClient,
  input: { orgId: string; templateId: string },
): Promise<FormTemplateRow | null> {
  const result = await client.query<Omit<FormTemplateRow, "builtIn">>(
    `SELECT ${TEMPLATE_COLUMNS}
     FROM scout_form_templates t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.org_id = $1::uuid AND t.id = $2::uuid`,
    [input.orgId, input.templateId],
  );
  const row = result.rows[0];
  return row ? { ...row, builtIn: false } : null;
}

/** Save-as-template. Same name + kind (case-insensitive) replaces the definition. */
export async function saveFormTemplate(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    description?: string | null;
    formKind: EntryType;
    sourceYear?: number | null;
    definition: SchemaDefinition;
  },
): Promise<FormTemplateRow> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO scout_form_templates
       (org_id, name, description, form_kind, source_year, definition, field_count, created_by)
     VALUES ($1::uuid, $2::text, $3::text, $4::scout_schema_type, $5::int, $6::jsonb, $7::int, $8::uuid)
     ON CONFLICT (org_id, form_kind, lower(name)) DO UPDATE SET
       description = EXCLUDED.description,
       source_year = EXCLUDED.source_year,
       definition = EXCLUDED.definition,
       field_count = EXCLUDED.field_count,
       updated_at = now()
     RETURNING id`,
    [
      input.orgId,
      input.name.trim().slice(0, 80),
      (input.description ?? "").trim().slice(0, 500),
      input.formKind,
      input.sourceYear ?? null,
      JSON.stringify(input.definition),
      fieldCountOf(input.definition),
      input.userId,
    ],
  );
  const template = await loadFormTemplate(client, { orgId: input.orgId, templateId: result.rows[0]!.id });
  if (!template) throw new Error("Template was not saved");
  return template;
}

export async function deleteFormTemplate(
  client: PoolClient,
  input: { orgId: string; templateId: string },
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM scout_form_templates WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.templateId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Built-in starters: this season's and last season's game-year defaults plus the
 * year-agnostic interchange schema. Pure — the client can also call it for labels.
 */
export function starterTemplates(activeYear: number): StarterTemplate[] {
  const starters: StarterTemplate[] = [];
  const years = [...new Set([activeYear, activeYear - 1])].filter(isSeasonYear);
  for (const year of years) {
    for (const formKind of FORM_KINDS) {
      const definition = formKind === "match" ? matchSchemaForYear(year) : pitSchemaForYear(year);
      starters.push({
        id: `starter:${formKind}:${year}`,
        name: definition.title,
        description:
          year === activeYear
            ? `This season's ${formKind} starter from the game pack.`
            : `Last season's ${formKind} starter — keys match community scouting practice.`,
        formKind,
        sourceYear: year,
        definition,
        fieldCount: fieldCountOf(definition),
        builtIn: true,
      });
    }
  }
  for (const formKind of FORM_KINDS) {
    const definition = formKind === "match" ? DEFAULT_MATCH_SCHEMA : DEFAULT_PIT_SCHEMA;
    starters.push({
      id: `starter:${formKind}:generic`,
      name: `Generic ${formKind} form`,
      description: "Year-agnostic interchange fields (video re-scout / imports).",
      formKind,
      sourceYear: null,
      definition,
      fieldCount: fieldCountOf(definition),
      builtIn: true,
    });
  }
  return starters;
}

export function starterById(activeYear: number, starterId: string): StarterTemplate | null {
  return starterTemplates(activeYear).find((starter) => starter.id === starterId) ?? null;
}
