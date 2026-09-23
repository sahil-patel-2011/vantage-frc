/**
 * "Import changes from Excel", end to end, on one withRls client.
 *
 *   preview  read the Vantage* tables from the workbook, load the matching Postgres rows,
 *            diff (workbook-import.ts). Writes nothing.
 *   apply    the same read + diff again (preview is stateless), then write only the changes
 *            whose fingerprints the owner/admin confirmed. A change whose row moved on since
 *            the preview no longer has the same fingerprint, or fails the guarded UPDATE, and
 *            is counted as a conflict instead of overwriting anything. Every apply records a
 *            workbook_import_runs row (migration 0676).
 *
 * Writes go through the paths the product already uses, so RLS applies unchanged:
 *  - pick list: lib/picklist/store.ts applyImportedEntryEdits (locks the list's entries,
 *    re-checks each entry's updated_at, renumbers like a drag, bumps revisions);
 *  - scouting: the author-or-admin UPDATE the match_entries_author_update /
 *    pit_entries_author_update policies (0003) allow, guarded on the row's exact updated_at.
 *
 * Request-path code: parameterized SQL on the caller's withRls client, never @vantage/db/admin.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { type SchemaDefinition, validatePayload } from "@vantage/scouting";
import { stripScoutIdentityFields } from "@vantage/scouting/identity";
import { type ImportedEntryEdit, applyImportedEntryEdits, listPickList } from "../picklist";
import type { PickBucket } from "../picklist/types";
import { isUuid } from "./authz";
import { type MicrosoftConfig, type RetryOptions, describeGraphError, isGraphError } from "./graph";
import { type ConnectFailure, connectMicrosoftGraph } from "./run-sync";
import {
  IMPORT_TABLES,
  type ImportChange,
  type ImportEntity,
  type ImportPreview,
  type ImportSource,
  type PickImportRow,
  type ScoutFieldCheck,
  type ScoutImportRow,
  type WorkbookReader,
  type WorkbookTableRead,
  diffWorkbook,
  workbookColumnValues,
} from "./workbook-import";
import { normalizeTimestamp } from "./workbook-sync";
import { GraphWorkbookTarget } from "./workbook-target";

export const IMPORT_NOT_MIGRATED_MESSAGE =
  "Importing from Excel is not switched on for this server yet. It needs a database update (migration 0676).";

/** How many of each list the preview response carries. Apply always re-derives everything. */
export const PREVIEW_LIST_CAP = 500;

// ------------------------------------------------------------------ reading Postgres

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

export type Reads = Partial<Record<ImportEntity, WorkbookTableRead | null>>;

/**
 * The Postgres side of the diff, scoped like the export (the active event, or every event
 * when none is set) plus any row the workbook names by id, so a changed active event does
 * not turn every row into "cannot match".
 */
export async function loadImportSource(client: PoolClient, orgId: string, reads: Reads): Promise<ImportSource> {
  const context = (
    await client.query<{ activeEventKey: string | null }>(
      `SELECT active_event_key AS "activeEventKey" FROM org_active_context WHERE org_id = $1::uuid`,
      [orgId],
    )
  ).rows[0];
  const eventKey = context?.activeEventKey?.trim() || null;

  const matchIds = workbookColumnValues(reads.MatchScouting, "id").filter(isUuid).slice(0, 30_000);
  const pitIds = workbookColumnValues(reads.PitScouting, "id").filter(isUuid).slice(0, 30_000);

  const matchScouting = (
    await client.query<ScoutImportRow>(
      `SELECT e.id::text AS id, e.event_key AS "eventKey", e.match_key AS "matchKey", e.team_key AS "teamKey",
              u.name AS "scoutName", e.confidence::text AS confidence, e.source::text AS source,
              to_char(e.created_at AT TIME ZONE 'UTC', ${ISO}) AS "createdAt",
              to_char(e.updated_at AT TIME ZONE 'UTC', ${ISO}) AS "updatedAt",
              e.updated_at::text AS version, e.schema_id::text AS "schemaId", e.payload,
              ($2::text IS NULL OR e.event_key = $2::text) AS "inScope"
         FROM match_scout_entries e
         LEFT JOIN users u ON u.id = e.scout_user_id
        WHERE e.org_id = $1::uuid
          AND ($2::text IS NULL OR e.event_key = $2::text OR e.id = ANY($3::uuid[]))
        ORDER BY e.event_key, e.match_key, e.team_key, e.created_at, e.id
        LIMIT 50000`,
      [orgId, eventKey, matchIds],
    )
  ).rows;
  const pitScouting = (
    await client.query<ScoutImportRow>(
      `SELECT e.id::text AS id, e.event_key AS "eventKey", e.team_key AS "teamKey",
              u.name AS "scoutName", e.confidence::text AS confidence, e.source::text AS source,
              to_char(e.created_at AT TIME ZONE 'UTC', ${ISO}) AS "createdAt",
              to_char(e.updated_at AT TIME ZONE 'UTC', ${ISO}) AS "updatedAt",
              e.updated_at::text AS version, e.schema_id::text AS "schemaId", e.payload,
              ($2::text IS NULL OR e.event_key = $2::text) AS "inScope"
         FROM pit_scout_entries e
         LEFT JOIN users u ON u.id = e.scout_user_id
        WHERE e.org_id = $1::uuid
          AND ($2::text IS NULL OR e.event_key = $2::text OR e.id = ANY($3::uuid[]))
        ORDER BY e.event_key, e.team_key, e.created_at, e.id
        LIMIT 50000`,
      [orgId, eventKey, pitIds],
    )
  ).rows;

  // The pick list the workbook was written from (its pick_list_id column), else the list
  // every pick-list surface shows for the active event.
  const listIds = workbookColumnValues(reads.PickList, "pick_list_id");
  const namedList = listIds.length === 1 && isUuid(listIds[0]) ? listIds[0] : null;
  const snapshot =
    (namedList ? await listPickList(client, { orgId, pickListId: namedList }) : null) ??
    (await listPickList(client, { orgId, eventKey }));
  const listInScope = snapshot ? listIds.length === 0 || snapshot.list.id === namedList : false;
  const pickEntries: PickImportRow[] = snapshot
    ? snapshot.entries.map((entry) => ({
        id: entry.id,
        pickListId: snapshot.list.id,
        listName: snapshot.list.name,
        listStatus: snapshot.list.status,
        listSource: snapshot.list.source,
        eventKey: snapshot.list.eventKey,
        rank: entry.rank,
        teamKey: entry.teamKey,
        teamNumber: entry.teamNumber,
        nickname: entry.nickname,
        bucket: entry.bucket,
        tier: entry.tier,
        notes: entry.notes,
        weightedScore: entry.weightedScore,
        voteCount: entry.votes.length,
        draftedAllianceSeed: entry.draftedAllianceSeed,
        draftedPickSlot: entry.draftedPickSlot,
        updatedByName: entry.updatedByName,
        updatedAt: normalizeTimestamp(entry.updatedAt),
        version: entry.updatedAt,
        inScope: listInScope,
      }))
    : [];

  return {
    activeEventKey: eventKey,
    pickList: snapshot ? { id: snapshot.list.id, name: snapshot.list.name, status: snapshot.list.status } : null,
    pickEntries,
    matchScouting: matchScouting.map((row) => ({ ...row, inScope: Boolean(row.inScope) })),
    pitScouting: pitScouting.map((row) => ({ ...row, inScope: Boolean(row.inScope) })),
  };
}

const NUMERIC_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
/** Field types whose answer is stored as text (validatePayload: "must be text"). Excel may hand back 5 for "5". */
const TEXT_FIELD_TYPES = new Set<string>([
  "text",
  "select",
  "dropdown",
  "short_answer",
  "long_text",
  "drivetrain_type",
  "multiple_choice",
]);

/**
 * Each scouting answer must pass the entry's own form, the same validatePayload the scouting
 * sync runs. Scout-identity fields are stripped first (they are locked to the membership),
 * so they can never be edited from Excel.
 */
export async function loadScoutFieldCheck(client: PoolClient, orgId: string, schemaIds: string[]): Promise<ScoutFieldCheck> {
  const ids = [...new Set(schemaIds.filter(isUuid))];
  const definitions = new Map<string, SchemaDefinition>();
  if (ids.length > 0) {
    const rows = (
      await client.query<{ id: string; definition: unknown }>(
        `SELECT id::text AS id, schema AS definition FROM scout_schemas WHERE org_id = $1::uuid AND id = ANY($2::uuid[])`,
        [orgId, ids],
      )
    ).rows;
    for (const row of rows) {
      const definition = row.definition as SchemaDefinition | null;
      if (definition && Array.isArray(definition.fields)) {
        definitions.set(row.id, stripScoutIdentityFields(definition).definition);
      }
    }
  }
  return ({ schemaId, key, value }) => {
    const definition = schemaId ? definitions.get(schemaId) : undefined;
    if (!definition) {
      return { ok: false, reason: "Vantage cannot find the scouting form this entry used, so it cannot check the new answer." };
    }
    const field = definition.fields.find((candidate) => candidate.key === key);
    if (!field) return { ok: false, reason: "This column is not a question on the entry's scouting form." };
    let next = value;
    if (field.type === "number" && typeof next === "string" && NUMERIC_TEXT.test(next.trim())) next = Number(next.trim());
    if (field.type === "boolean" && typeof next === "string" && /^(true|false)$/i.test(next.trim())) {
      next = next.trim().toLowerCase() === "true";
    }
    if (TEXT_FIELD_TYPES.has(field.type) && (typeof next === "number" || typeof next === "boolean")) next = String(next);
    const errors = validatePayload({ ...definition, fields: [field] }, { [key]: next });
    return errors.length > 0 ? { ok: false, reason: errors[0]! } : { ok: true, value: next };
  };
}

/** Read the three tables, one request at a time (Microsoft's guidance for one workbook). */
export async function readImportTables(reader: WorkbookReader): Promise<Reads> {
  const reads: Reads = {};
  for (const ref of IMPORT_TABLES) reads[ref.entity] = await reader.readTable(ref);
  return reads;
}

export async function buildImportPreview(
  client: PoolClient,
  orgId: string,
  reads: Reads,
): Promise<{ preview: ImportPreview; source: ImportSource }> {
  const source = await loadImportSource(client, orgId, reads);
  const schemaIds = [...source.matchScouting, ...source.pitScouting].flatMap((row) => (row.schemaId ? [row.schemaId] : []));
  const checkScoutField = await loadScoutFieldCheck(client, orgId, schemaIds);
  return { preview: diffWorkbook(reads, source, { checkScoutField }), source };
}

// ------------------------------------------------------------------ the preview the browser sees

export type PublicChange = Pick<ImportChange, "id" | "entity" | "label" | "field" | "from" | "to">;

export type PublicPreview = {
  totals: ImportPreview["totals"];
  tables: Array<{
    entity: ImportEntity;
    found: boolean;
    rowsRead: number;
    notice: string | null;
    changes: PublicChange[];
    conflicts: ImportPreview["tables"][number]["conflicts"];
    readOnlyEdits: ImportPreview["tables"][number]["readOnlyEdits"];
    invalid: ImportPreview["tables"][number]["invalid"];
    unmatched: number;
    notInWorkbook: number;
    withoutId: number;
    duplicateIds: number;
    unknownColumns: string[];
    missingColumns: string[];
    truncatedLists: boolean;
  }>;
};

/** Counts in full; lists capped. No row version, no typed value, no raw cells beyond what is shown. */
export function toPublicPreview(preview: ImportPreview, cap = PREVIEW_LIST_CAP): PublicPreview {
  return {
    totals: preview.totals,
    tables: preview.tables.map((table) => ({
      entity: table.entity,
      found: table.found,
      rowsRead: table.rowsRead,
      notice: table.notice,
      changes: table.changes.slice(0, cap).map(({ id, entity, label, field, from, to }) => ({ id, entity, label, field, from, to })),
      conflicts: table.conflicts.slice(0, cap),
      readOnlyEdits: table.readOnlyEdits.slice(0, cap),
      invalid: table.invalid.slice(0, cap),
      unmatched: table.unmatched.length,
      notInWorkbook: table.notInWorkbook.length,
      withoutId: table.withoutId,
      duplicateIds: table.duplicateIds.length,
      unknownColumns: table.unknownColumns.slice(0, 50),
      missingColumns: table.missingColumns,
      truncatedLists: [table.changes, table.conflicts, table.readOnlyEdits, table.invalid].some((list) => list.length > cap),
    })),
  };
}

// ------------------------------------------------------------------ apply

export type ApplyResult =
  | { status: "busy" }
  | { status: "not_migrated" }
  | { status: "failed"; runId: string; error: string }
  | {
      status: "applied" | "nothing_applied";
      runId: string;
      applied: number;
      conflicts: number;
      skipped: number;
      /** Confirmed changes that no longer match the preview (the row or the cell moved on). */
      stale: number;
      /** Confirmed changes whose row changed between the preview and this write. */
      lateConflicts: number;
    };

export type ApplyOptions = {
  orgId: string;
  userId: string;
  changeIds: string[];
  openReader: () => Promise<WorkbookReader>;
  now?: () => Date;
};

type TableSummary = {
  applied: number;
  rows: string[];
  fields: string[];
  conflicts: number;
  invalid: number;
  readOnlyEdits: number;
  unmatched: number;
  notInWorkbook: number;
  withoutId: number;
  duplicateIds: number;
};

export async function importTableReady(client: PoolClient): Promise<boolean> {
  const row = (await client.query<{ ready: boolean }>(`SELECT to_regclass('workbook_import_runs') IS NOT NULL AS ready`)).rows[0];
  return Boolean(row?.ready);
}

async function recordRun(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    status: "applied" | "nothing_applied" | "failed";
    startedAt: string;
    applied: number;
    conflicts: number;
    skipped: number;
    summary: unknown;
    error: string | null;
  },
): Promise<string> {
  const row = (
    await client.query<{ id: string }>(
      `INSERT INTO workbook_import_runs
         (org_id, status, started_by, started_at, finished_at, applied, conflicts, skipped, summary, error)
       VALUES ($1::uuid, $2::text, $3::uuid, $4::timestamptz, now(), $5::int, $6::int, $7::int, $8::jsonb, $9::text)
       RETURNING id`,
      [
        input.orgId,
        input.status,
        input.userId,
        input.startedAt,
        input.applied,
        input.conflicts,
        input.skipped,
        JSON.stringify(input.summary),
        input.error?.slice(0, 2000) ?? null,
      ],
    )
  ).rows[0]!;
  return row.id;
}

async function updateScoutRow(
  client: PoolClient,
  entity: "MatchScouting" | "PitScouting",
  input: { orgId: string; rowId: string; version: string; patch: Record<string, unknown>; confidence: string | null },
): Promise<boolean> {
  const params = [input.rowId, input.orgId, JSON.stringify(input.patch), input.confidence, input.version];
  // Two literal statements rather than an interpolated table name. The role predicate
  // repeats the RLS UPDATE policy (author, or owner/admin) so the rule is visible here too.
  const result =
    entity === "MatchScouting"
      ? await client.query(
          `UPDATE match_scout_entries
              SET payload = payload || $3::jsonb,
                  confidence = COALESCE($4::scout_confidence, confidence),
                  updated_at = now()
            WHERE id = $1::uuid AND org_id = $2::uuid AND updated_at = $5::timestamptz
              AND (scout_user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
            RETURNING id`,
          params,
        )
      : await client.query(
          `UPDATE pit_scout_entries
              SET payload = payload || $3::jsonb,
                  confidence = COALESCE($4::scout_confidence, confidence),
                  updated_at = now()
            WHERE id = $1::uuid AND org_id = $2::uuid AND updated_at = $5::timestamptz
              AND (scout_user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
            RETURNING id`,
          params,
        );
  return (result.rowCount ?? 0) > 0;
}

function groupByRow(changes: ImportChange[]): Map<string, ImportChange[]> {
  const out = new Map<string, ImportChange[]>();
  for (const change of changes) {
    const list = out.get(change.rowId) ?? [];
    list.push(change);
    out.set(change.rowId, list);
  }
  return out;
}

/**
 * Re-read, re-diff, and write the confirmed changes. Holds the same per-team advisory lock
 * as Sync now, so an import and a sync never interleave on one team's workbook.
 */
export async function applyWorkbookImport(client: PoolClient, options: ApplyOptions): Promise<ApplyResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  if (!(await importTableReady(client))) return { status: "not_migrated" };
  const locked = (
    await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('microsoft-workbook-sync:' || $1::text, 0)) AS locked`,
      [options.orgId],
    )
  ).rows[0]?.locked;
  if (!locked) return { status: "busy" };

  // Microsoft-side failures are recorded as a failed run; a Postgres failure propagates and
  // rolls the whole transaction back (nothing half-applied).
  let reads: Reads;
  let reader: WorkbookReader | null = null;
  try {
    reader = await options.openReader();
    reads = await readImportTables(reader);
  } catch (error) {
    if (!isGraphError(error)) throw error;
    const message = describeGraphError(error);
    const runId = await recordRun(client, {
      orgId: options.orgId,
      userId: options.userId,
      status: "failed",
      startedAt,
      applied: 0,
      conflicts: 0,
      skipped: 0,
      summary: { confirmed: options.changeIds.length },
      error: message,
    });
    return { status: "failed", runId, error: message };
  } finally {
    await reader?.close().catch(() => undefined);
  }

  const { preview, source } = await buildImportPreview(client, options.orgId, reads);
  const all = preview.tables.flatMap((table) => table.changes);
  const known = new Set(all.map((change) => change.id));
  const confirmed = new Set(options.changeIds);
  const chosen = all.filter((change) => confirmed.has(change.id));
  const stale = [...confirmed].filter((id) => !known.has(id)).length;

  const appliedRows = new Map<ImportEntity, Set<string>>();
  const appliedFields = new Map<ImportEntity, Set<string>>();
  const lateConflictRows = new Map<ImportEntity, Set<string>>();
  let applied = 0;
  const mark = (map: Map<ImportEntity, Set<string>>, entity: ImportEntity, value: string) => {
    const set = map.get(entity) ?? new Set<string>();
    set.add(value);
    map.set(entity, set);
  };
  const landed = (change: ImportChange) => {
    applied += 1;
    mark(appliedRows, change.entity, change.rowId);
    mark(appliedFields, change.entity, change.field);
  };

  // Pick list: one call, so ranks are planned against the whole list at once.
  const pickChanges = chosen.filter((change) => change.entity === "PickList");
  if (pickChanges.length > 0 && source.pickList) {
    const edits: ImportedEntryEdit[] = [...groupByRow(pickChanges)].map(([rowId, changes]) => {
      const edit: ImportedEntryEdit = { entryId: rowId, expectedUpdatedAt: changes[0]!.version };
      for (const change of changes) {
        if (change.field === "rank") edit.rank = change.value as number;
        if (change.field === "bucket") edit.bucket = change.value as PickBucket;
        if (change.field === "notes") edit.notes = (change.value as string | null) ?? null;
      }
      return edit;
    });
    const result = await applyImportedEntryEdits(client, {
      orgId: options.orgId,
      userId: options.userId,
      pickListId: source.pickList.id,
      edits,
    });
    const done = new Set(result.applied);
    for (const change of pickChanges) {
      if (done.has(change.rowId)) landed(change);
      else mark(lateConflictRows, "PickList", change.rowId);
    }
  }

  // Scouting: one guarded UPDATE per entry, all of that entry's confirmed fields together.
  for (const entity of ["MatchScouting", "PitScouting"] as const) {
    for (const [rowId, changes] of groupByRow(chosen.filter((change) => change.entity === entity))) {
      const patch: Record<string, unknown> = {};
      let confidence: string | null = null;
      for (const change of changes) {
        if (change.field === "confidence") confidence = String(change.value);
        else if (change.payloadKey !== undefined) patch[change.payloadKey] = change.value ?? null;
      }
      const ok = await updateScoutRow(client, entity, {
        orgId: options.orgId,
        rowId,
        version: changes[0]!.version,
        patch,
        confidence,
      });
      if (ok) changes.forEach(landed);
      else mark(lateConflictRows, entity, rowId);
    }
  }

  const lateConflicts = [...lateConflictRows.values()].reduce((sum, set) => sum + set.size, 0);
  const t = preview.totals;
  const conflicts = t.conflicts + lateConflicts;
  const skipped = all.length - chosen.length + stale + t.invalid + t.readOnlyEdits + t.unmatched + t.withoutId + t.duplicateIds;

  // What changed, by row id and column name only — never cell contents.
  const summary: { confirmed: number; stale: number; tables: Record<string, TableSummary> } = {
    confirmed: confirmed.size,
    stale,
    tables: {},
  };
  for (const table of preview.tables) {
    summary.tables[table.entity] = {
      applied: chosen.filter((change) => change.entity === table.entity && appliedRows.get(table.entity)?.has(change.rowId)).length,
      rows: [...(appliedRows.get(table.entity) ?? [])].slice(0, 100),
      fields: [...(appliedFields.get(table.entity) ?? [])].slice(0, 100),
      conflicts: table.conflicts.length + (lateConflictRows.get(table.entity)?.size ?? 0),
      invalid: table.invalid.length,
      readOnlyEdits: table.readOnlyEdits.length,
      unmatched: table.unmatched.length,
      notInWorkbook: table.notInWorkbook.length,
      withoutId: table.withoutId,
      duplicateIds: table.duplicateIds.length,
    };
  }

  const status = applied > 0 ? "applied" : "nothing_applied";
  const runId = await recordRun(client, {
    orgId: options.orgId,
    userId: options.userId,
    status,
    startedAt,
    applied,
    conflicts,
    skipped,
    summary,
    error: null,
  });
  return { status, runId, applied, conflicts, skipped, stale, lateConflicts };
}

// ------------------------------------------------------------------ route entry points

export type ImportFailure =
  | ConnectFailure
  | { status: "no_workbook" }
  | { status: "not_migrated" }
  | { status: "microsoft_error"; error: string };

async function openReaderFor(client: PoolClient, input: { orgId: string; config: MicrosoftConfig; retry?: RetryOptions }) {
  const connected = await connectMicrosoftGraph(client, input);
  if (connected.status !== "ok") return connected;
  const itemId = connected.secret.workbookItemId;
  if (!itemId) return { status: "no_workbook" as const };
  return {
    status: "ok" as const,
    open: () => GraphWorkbookTarget.open(connected.graph, itemId, { persistChanges: false }),
  };
}

function graphFailure(error: unknown): ImportFailure {
  if (isGraphError(error) && error.kind === "not_found") return { status: "no_workbook" };
  if (isGraphError(error) && error.kind === "auth_expired") return { status: "reconnect_required", error: describeGraphError(error) };
  return { status: "microsoft_error", error: describeGraphError(error) };
}

export async function runImportPreview(
  client: PoolClient,
  input: { orgId: string; config: MicrosoftConfig; retry?: RetryOptions },
): Promise<{ status: "ok"; preview: PublicPreview } | ImportFailure> {
  if (!(await importTableReady(client))) return { status: "not_migrated" };
  const opened = await openReaderFor(client, input);
  if (opened.status !== "ok") return opened;
  let reader: WorkbookReader | null = null;
  let reads: Reads;
  try {
    reader = await opened.open();
    reads = await readImportTables(reader);
  } catch (error) {
    if (!isGraphError(error)) throw error;
    return graphFailure(error);
  } finally {
    await reader?.close().catch(() => undefined);
  }
  const { preview } = await buildImportPreview(client, input.orgId, reads);
  return { status: "ok", preview: toPublicPreview(preview) };
}

export async function runImportApply(
  client: PoolClient,
  input: { orgId: string; userId: string; changeIds: string[]; config: MicrosoftConfig; retry?: RetryOptions },
): Promise<ApplyResult | ImportFailure> {
  if (!(await importTableReady(client))) return { status: "not_migrated" };
  const opened = await openReaderFor(client, input);
  if (opened.status !== "ok") return opened;
  try {
    return await applyWorkbookImport(client, {
      orgId: input.orgId,
      userId: input.userId,
      changeIds: input.changeIds,
      openReader: opened.open,
    });
  } catch (error) {
    // Only reached for a Graph error thrown outside the recorded path (e.g. while opening).
    if (!isGraphError(error)) throw error;
    return graphFailure(error);
  }
}
