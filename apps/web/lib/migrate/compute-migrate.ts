import type { PoolClient } from "@neondatabase/serverless";
import { withSavepointOrThrow } from "@vantage/db";
import { importScoutData, type FieldType, type SchemaDefinition } from "@vantage/scouting";
import { ScoutingRepository } from "@vantage/scouting/repository";
import { createOrganizationInvite, deliverInviteEmail, type OrgRole } from "@vantage/core";
import {
  applyPreset,
  autoDetectColumns,
  hoursDraftsFromCsv,
  icsEventsToDrafts,
  notionPagesToDrafts,
  parseIcs,
  parseCsvHeaders,
  presetColumnsFromMapping,
  purpleStandardEntriesToDrafts,
  qrScoutConfigToFormDraft,
  qrScoutPayloadsToDrafts,
  scoutradiozToDrafts,
  stimsRosterToInviteDrafts,
  suggestColumnMap,
  trelloCardsToTaskDrafts,
  trelloListStatusSuggestions,
  readTrelloBoard,
  TASK_STATUSES,
  type ColumnGuess,
  type ImportDraft,
  type MappingPreset,
  type NotionPage,
  type ScoutEntryDraft,
  type ScoutFormDraft,
  type TaskStatus,
  type VantageFieldType,
} from "@vantage/import";
import { slugifyTitle } from "../knowledge/helpers";

/**
 * `@vantage/import` stays dependency-free, so it mirrors the scouting field-type
 * names rather than importing them. These two assertions are what keep the
 * mirror honest: if `VANTAGE_FIELD_TYPES` ever names a type `FieldType` does not
 * have, or an imported form draft stops being a `SchemaDefinition`, `tsc` fails
 * here instead of the form builder failing on a team's real import.
 */
type _FieldTypeMirrorIsExact = VantageFieldType extends FieldType ? true : never;
const _fieldTypeMirrorIsExact: _FieldTypeMirrorIsExact = true;
void _fieldTypeMirrorIsExact;

/** The form-builder draft an imported form is loaded into. */
export type ImportedFormDefinition = SchemaDefinition;

function asSchemaDefinition(draft: ScoutFormDraft): ImportedFormDefinition {
  return {
    title: draft.definition.title,
    fields: draft.definition.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type as FieldType,
      ...(field.required === undefined ? {} : { required: field.required }),
      ...(field.options ? { options: field.options } : {}),
      ...(field.helpText ? { helpText: field.helpText } : {}),
      ...(field.config ? { config: field.config } : {}),
    })),
  };
}

export type MigrateSetupStep = { id: string; label: string; detail: string; href: string };

export type ImportConnectionRow = {
  id: string;
  provider: string;
  status: string;
  label: string;
  sourceUrl: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
};

export type MigrateView =
  | {
      status: "setup_required";
      message: string;
      steps: MigrateSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      connections: ImportConnectionRow[];
      inboundFeeds: Array<{ id: string; icsUrl: string }>;
      notionReady: boolean;
      computedAt: string;
    };

function setup(message: string, orgId: string | null): MigrateView {
  return {
    status: "setup_required",
    message,
    orgId,
    steps: [
      { id: "workspace", label: "Select workspace", detail: "Claim or join a team before importing.", href: "/workspace" },
      {
        id: "admin",
        label: "Owner or admin",
        detail: "Only owners and admins can connect Notion, ICS, or Sheets.",
        href: orgId ? `/team/admin?orgId=${encodeURIComponent(orgId)}` : "/team/admin",
      },
    ],
  };
}

export async function computeMigrateView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MigrateView> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role
     FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) return setup("Select a team workspace to import Notion, calendars, or scouting CSVs.", null);

  const [connections, feeds] = await Promise.all([
    client.query<ImportConnectionRow>(
      `SELECT id, provider, status, label, source_url AS "sourceUrl", last_error AS "lastError",
              last_synced_at::text AS "lastSyncedAt"
       FROM import_connections WHERE org_id = $1 ORDER BY provider, created_at`,
      [org.orgId],
    ),
    client.query<{ id: string; icsUrl: string }>(
      `SELECT id, ics_url AS "icsUrl" FROM calendar_inbound_feeds WHERE org_id = $1 ORDER BY created_at`,
      [org.orgId],
    ),
  ]);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    connections: connections.rows,
    inboundFeeds: feeds.rows,
    notionReady: Boolean(process.env.NOTION_CLIENT_ID?.trim()),
    computedAt: new Date().toISOString(),
  };
}

export function previewIcs(content: string): ImportDraft[] {
  return icsEventsToDrafts(parseIcs(content));
}

export function previewCsvHeaders(content: string) {
  const headers = parseCsvHeaders(content);
  return { headers, columnMap: suggestColumnMap(headers) };
}

export async function upsertIcsConnection(
  client: PoolClient,
  input: { orgId: string; userId: string; icsUrl: string; label?: string },
): Promise<void> {
  let url: URL;
  try {
    url = new URL(input.icsUrl);
  } catch {
    throw new Error("ICS URL must be a valid http(s) address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("ICS URL must be http or https");
  }
  const connection = await client.query<{ id: string }>(
    `INSERT INTO import_connections (org_id, provider, status, label, source_url, created_by)
     VALUES ($1, 'ics', 'connected', $2, $3, $4)
     RETURNING id`,
    [input.orgId, input.label?.trim() || "ICS feed", url.toString(), input.userId],
  );
  await client.query(
    `INSERT INTO calendar_inbound_feeds (org_id, connection_id, ics_url, created_by)
     VALUES ($1, $2, $3, $4)`,
    [input.orgId, connection.rows[0]!.id, url.toString(), input.userId],
  );
}

export async function commitIcsDrafts(
  client: PoolClient,
  input: { orgId: string; userId: string; drafts: ImportDraft[] },
): Promise<number> {
  let written = 0;
  for (const draft of input.drafts) {
    if (draft.kind !== "calendar" || !draft.startsAt) continue;
    const uid =
      (typeof draft.payload?.uid === "string" && draft.payload.uid.trim() ? draft.payload.uid.trim() : null) ??
      draft.provenance.sourceId ??
      null;
    if (!uid) continue;
    const result = await client.query(
      `INSERT INTO subteam_calendar_events (
         org_id, title, kind, starts_at, ends_at, location, notes, created_by, import_uid
       )
       SELECT $1, $2, 'event', $3::timestamptz, $4::timestamptz, $5, $6, $7, $8
       WHERE NOT EXISTS (
         SELECT 1 FROM subteam_calendar_events WHERE org_id = $1::uuid AND import_uid = $8
       )`,
      [
        input.orgId,
        draft.title.slice(0, 200),
        draft.startsAt,
        draft.endsAt ?? null,
        typeof draft.payload?.location === "string" ? draft.payload.location.slice(0, 200) : "",
        (draft.body ?? "").slice(0, 4000),
        input.userId,
        uid,
      ],
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

export async function fetchAndCommitIcsUrl(
  client: PoolClient,
  input: { orgId: string; userId: string; icsUrl: string },
): Promise<number> {
  let url: URL;
  try {
    url = new URL(input.icsUrl);
  } catch {
    throw new Error("ICS URL must be a valid http(s) address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("ICS URL must be http or https");
  }
  const response = await fetch(url.toString(), {
    headers: { accept: "text/calendar, text/plain, */*" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ICS feed returned HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 2_000_000) throw new Error("ICS feed is larger than 2 MB");
  const content = new TextDecoder().decode(buffer);
  return commitIcsDrafts(client, {
    orgId: input.orgId,
    userId: input.userId,
    drafts: icsEventsToDrafts(parseIcs(content), url.toString()),
  });
}

export function previewNotionJson(content: string): ImportDraft[] {
  const parsed = JSON.parse(content) as unknown;
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  return notionPagesToDrafts(pages as NotionPage[]);
}

export async function commitKnowledgeDrafts(
  client: PoolClient,
  input: { orgId: string; userId: string; drafts: ImportDraft[] },
): Promise<number> {
  let written = 0;
  for (const draft of input.drafts) {
    if (draft.kind !== "knowledge") continue;
    const sourceId = draft.provenance.sourceId?.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 12) ?? "import";
    const slug = `${slugifyTitle(draft.title)}-${sourceId}`.slice(0, 80);
    const body = [
      draft.body ?? "",
      "",
      `Imported from ${draft.provenance.source}${draft.provenance.sourceUrl ? ` (${draft.provenance.sourceUrl})` : ""} at ${draft.provenance.importedAt}.`,
    ]
      .join("\n")
      .trim();
    const result = await client.query(
      `INSERT INTO knowledge_pages
         (org_id, slug, title, body, template_kind, season_year, tags, pinned, created_by, updated_by)
       VALUES ($1::uuid, $2, $3, $4, 'note', NULL, ARRAY['imported']::text[], false, $5::uuid, $5::uuid)
       ON CONFLICT (org_id, slug) DO NOTHING`,
      [input.orgId, slug, draft.title.slice(0, 200), body.slice(0, 20_000), input.userId],
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

export async function commitTaskDrafts(
  client: PoolClient,
  input: { orgId: string; userId: string; drafts: ImportDraft[]; seasonYear: number },
): Promise<number> {
  let written = 0;
  for (const draft of input.drafts) {
    if (draft.kind !== "task") continue;
    const statusRaw = typeof draft.payload?.status === "string" ? draft.payload.status.toLowerCase() : "";
    const status =
      /done|complete|closed/.test(statusRaw)
        ? "done"
        : /progress|doing/.test(statusRaw)
          ? "in_progress"
          : /block/.test(statusRaw)
            ? "blocked"
            : "todo";
    const result = await client.query(
      `INSERT INTO build_tasks
         (org_id, title, subsystem, status, notes, season_year, created_by)
       SELECT $1::uuid, $2, 'imported', $3, $4, $5, $6::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM build_tasks WHERE org_id = $1::uuid AND title = $2 AND season_year = $5
       )`,
      [
        input.orgId,
        draft.title.slice(0, 200),
        status,
        `Imported from ${draft.provenance.source} at ${draft.provenance.importedAt}.`,
        input.seasonYear,
        input.userId,
      ],
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

export async function commitHoursCsv(
  client: PoolClient,
  input: { orgId: string; userId: string; content: string; seasonYear: number },
): Promise<number> {
  const drafts = hoursDraftsFromCsv(input.content);
  let written = 0;
  const events = new Map<string, string>();
  for (const draft of drafts) {
    const occurredOn = typeof draft.payload?.occurredOn === "string" ? draft.payload.occurredOn : null;
    if (!occurredOn) continue;
    const hours = typeof draft.payload?.hours === "number" ? draft.payload.hours : Number(draft.payload?.hours);
    const person = typeof draft.payload?.person === "string" ? draft.payload.person : draft.title;
    if (!person || !Number.isFinite(hours) || hours <= 0) continue;
    let eventId = events.get(occurredOn);
    if (!eventId) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM attendance_events
         WHERE org_id = $1 AND occurred_on = $2::date AND title = $3
         LIMIT 1`,
        [input.orgId, occurredOn, `Imported hours ${occurredOn}`],
      );
      eventId = existing.rows[0]?.id;
      if (!eventId) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO attendance_events
             (org_id, title, kind, occurred_on, credit_hours, season_year, created_by)
           VALUES ($1, $2, 'build', $3::date, 0, $4, $5)
           RETURNING id`,
          [input.orgId, `Imported hours ${occurredOn}`, occurredOn, input.seasonYear, input.userId],
        );
        eventId = inserted.rows[0]!.id;
      }
      events.set(occurredOn, eventId);
    }
    const result = await client.query(
      `INSERT INTO attendance_entries (org_id, event_id, person_name, role, hours)
       SELECT $1::uuid, $2::uuid, $3, 'student', $4
       WHERE NOT EXISTS (
         SELECT 1 FROM attendance_entries
         WHERE org_id = $1::uuid AND event_id = $2::uuid AND person_name = $3
       )`,
      [input.orgId, eventId, person.slice(0, 120), hours],
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

function coerceScoutPayload(
  fields: Array<{ key: string; type: string }>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(fields.map((field) => field.key));
  const next: Record<string, unknown> = {};
  for (const field of fields) {
    if (!allowed.has(field.key)) continue;
    let value = payload[field.key];
    if (value === undefined || value === "") continue;
    if (field.type === "number" && typeof value === "string") {
      const number = Number(value);
      if (!Number.isFinite(number)) continue;
      value = number;
    }
    if (field.type === "boolean" && typeof value === "string") {
      value = /^(1|true|yes|y)$/i.test(value.trim());
    }
    next[field.key] = value;
  }
  return next;
}

export async function commitScoutCsv(
  client: PoolClient,
  input: { orgId: string; userId: string; content: string },
): Promise<number> {
  const records = importScoutData({ content: input.content, format: "csv", source: "google_sheets" });
  if (!records.length) return 0;
  const repository = new ScoutingRepository(client);
  let written = 0;
  const schemaByEvent = new Map<string, { id: string; fields: Array<{ key: string; type: string }> }>();
  for (const record of records) {
    if (!record.matchKey) continue;
    let schema = schemaByEvent.get(record.eventKey);
    if (!schema) {
      await repository.ensureDefaultSchemas(input.orgId, input.userId, record.eventKey);
      const row = await client.query<{ id: string; definition: { fields: Array<{ key: string; type: string }> } }>(
        `SELECT id, schema AS definition FROM scout_schemas
         WHERE org_id = $1 AND type = 'match'
           AND year = (SELECT year FROM events_ref WHERE event_key = $2)
         ORDER BY version DESC LIMIT 1`,
        [input.orgId, record.eventKey],
      );
      const found = row.rows[0];
      if (!found) continue;
      schema = { id: found.id, fields: found.definition.fields ?? [] };
      schemaByEvent.set(record.eventKey, schema);
    }
    const ack = await repository.syncEntry(input.orgId, input.userId, {
      clientId: record.clientId,
      type: "match",
      eventKey: record.eventKey,
      matchKey: record.matchKey,
      teamKey: record.teamKey,
      schemaId: schema.id,
      payload: coerceScoutPayload(schema.fields, record.payload),
      confidence: "normal",
      source: "import",
      updatedAt: record.provenance.importedAt,
    });
    if (!ack.duplicate) written += 1;
  }
  return written;
}

/* -------------------------------------------------------------------------- *
 * Shared scouting-entry commit path
 *
 * The Purple Standard, QRScout, and Scoutradioz all produce `ScoutEntryDraft`s,
 * so they all land here. The draft's `idempotencyKey` becomes the scouting
 * sync `clientId`, which is the (org_id, client_id) receipt the repository
 * already dedupes on — so re-importing the same file writes nothing new and
 * reports the rows as duplicates rather than as failures.
 * -------------------------------------------------------------------------- */

export type ScoutCommitReport = {
  written: number;
  duplicates: number;
  /** Draft fields that are not on the org's form, so were NOT stored. */
  unmappedFields: string[];
  /** Rows the repository refused, with the reason it gave. */
  rejected: Array<{ ref: string; reason: string }>;
  /** Rows the parser itself declined, carried through for the review UI. */
  skipped: Array<{ ref: string; reason: string }>;
  errors: Array<{ ref: string; message: string }>;
};

export async function commitScoutEntryDrafts(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    drafts: ScoutEntryDraft[];
    skipped?: Array<{ ref: string; reason: string }>;
    errors?: Array<{ ref: string; message: string }>;
  },
): Promise<ScoutCommitReport> {
  const report: ScoutCommitReport = {
    written: 0,
    duplicates: 0,
    unmappedFields: [],
    rejected: [],
    skipped: input.skipped ?? [],
    errors: input.errors ?? [],
  };
  if (!input.drafts.length) return report;

  const repository = new ScoutingRepository(client);
  const schemaCache = new Map<string, { id: string; fields: Array<{ key: string; type: string }> } | null>();
  const unmapped = new Set<string>();

  for (const draft of input.drafts) {
    const cacheKey = `${draft.eventKey}:${draft.entryType}`;
    let schema = schemaCache.get(cacheKey);
    if (schema === undefined) {
      await repository.ensureDefaultSchemas(input.orgId, input.userId, draft.eventKey);
      const row = await client.query<{
        id: string;
        definition: { fields: Array<{ key: string; type: string }> };
      }>(
        `SELECT id, schema AS definition FROM scout_schemas
         WHERE org_id = $1 AND type = $3
           AND year = (SELECT year FROM events_ref WHERE event_key = $2)
         ORDER BY version DESC LIMIT 1`,
        [input.orgId, draft.eventKey, draft.entryType],
      );
      const found = row.rows[0];
      schema = found ? { id: found.id, fields: found.definition.fields ?? [] } : null;
      schemaCache.set(cacheKey, schema);
    }
    if (!schema) {
      report.rejected.push({
        ref: draft.title,
        reason: `No ${draft.entryType} form exists for ${draft.eventKey}. Add the event, then import again.`,
      });
      continue;
    }

    // Report every field the org's form does not have, rather than dropping it
    // silently — the coach needs to know the import was partial.
    const known = new Set(schema.fields.map((field) => field.key));
    for (const key of Object.keys(draft.payload)) {
      if (!known.has(key)) unmapped.add(key);
    }

    try {
      const ack = await repository.syncEntry(input.orgId, input.userId, {
        clientId: draft.idempotencyKey,
        type: draft.entryType,
        eventKey: draft.eventKey,
        ...(draft.matchKey ? { matchKey: draft.matchKey } : {}),
        teamKey: draft.teamKey,
        schemaId: schema.id,
        payload: coerceScoutPayload(schema.fields, draft.payload),
        confidence: "normal",
        source: "import",
        updatedAt: draft.provenance.importedAt,
      });
      if (ack.duplicate) report.duplicates += 1;
      else report.written += 1;
    } catch (error) {
      report.rejected.push({
        ref: draft.title,
        reason: error instanceof Error ? error.message : "the scouting repository refused this row",
      });
    }
  }

  report.unmappedFields = Array.from(unmapped).sort();
  return report;
}

/* -------------------------------------------------------------------------- *
 * The Purple Standard
 * -------------------------------------------------------------------------- */

export function previewPurpleStandard(content: string, eventKey?: string) {
  const result = purpleStandardEntriesToDrafts({ content, eventKey });
  return {
    drafts: result.drafts,
    skipped: result.skipped,
    errors: result.errors,
  };
}

export async function commitPurpleStandard(
  client: PoolClient,
  input: { orgId: string; userId: string; content: string; eventKey?: string },
): Promise<ScoutCommitReport> {
  const result = purpleStandardEntriesToDrafts({ content: input.content, eventKey: input.eventKey });
  return commitScoutEntryDrafts(client, {
    orgId: input.orgId,
    userId: input.userId,
    drafts: result.drafts,
    skipped: result.skipped,
    errors: result.errors,
  });
}

/* -------------------------------------------------------------------------- *
 * QRScout
 * -------------------------------------------------------------------------- */

/**
 * config.json -> a form draft. The form builder holds its draft in client
 * state, so an import hands back the `SchemaDefinition` for the builder to
 * load. Nothing is published, and nothing is written to `scout_schemas`.
 */
export function previewQrScoutForm(content: string, entryType: "match" | "pit" = "match") {
  const result = qrScoutConfigToFormDraft({ content, entryType });
  const draft = result.drafts[0];
  return {
    definition: draft ? asSchemaDefinition(draft) : null,
    entryType,
    skipped: result.skipped,
    errors: result.errors,
  };
}

export function previewQrScoutEntries(input: {
  configContent: string;
  payloadContent: string;
  eventKey: string;
}) {
  const result = qrScoutPayloadsToDrafts(input);
  return { drafts: result.drafts, skipped: result.skipped, errors: result.errors };
}

export async function commitQrScoutEntries(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    configContent: string;
    payloadContent: string;
    eventKey: string;
  },
): Promise<ScoutCommitReport> {
  const result = qrScoutPayloadsToDrafts(input);
  return commitScoutEntryDrafts(client, {
    orgId: input.orgId,
    userId: input.userId,
    drafts: result.drafts,
    skipped: result.skipped,
    errors: result.errors,
  });
}

/* -------------------------------------------------------------------------- *
 * Scoutradioz
 * -------------------------------------------------------------------------- */

export function previewScoutradioz(content: string, eventKey?: string) {
  const result = scoutradiozToDrafts({ content, eventKey });
  return { drafts: result.drafts, skipped: result.skipped, errors: result.errors };
}

export async function commitScoutradioz(
  client: PoolClient,
  input: { orgId: string; userId: string; content: string; eventKey?: string },
): Promise<ScoutCommitReport> {
  const result = scoutradiozToDrafts({ content: input.content, eventKey: input.eventKey });
  return commitScoutEntryDrafts(client, {
    orgId: input.orgId,
    userId: input.userId,
    drafts: result.drafts,
    skipped: result.skipped,
    errors: result.errors,
  });
}

/* -------------------------------------------------------------------------- *
 * Trello
 * -------------------------------------------------------------------------- */

/** Step one of the Trello flow: show every list so the user maps it to a status. */
export function previewTrelloLists(content: string) {
  const board = readTrelloBoard(content);
  return {
    boardName: board.name ?? "Trello board",
    lists: trelloListStatusSuggestions(board),
    statuses: TASK_STATUSES,
  };
}

function readListStatusMap(raw: unknown): Record<string, TaskStatus> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const allowed = new Set<string>(TASK_STATUSES);
  const map: Record<string, TaskStatus> = {};
  for (const [listId, status] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof status === "string" && allowed.has(status)) map[listId] = status as TaskStatus;
  }
  return map;
}

export function previewTrelloCards(input: {
  content: string;
  listStatus?: unknown;
  includeClosed?: boolean;
}) {
  const result = trelloCardsToTaskDrafts({
    content: input.content,
    listStatus: readListStatusMap(input.listStatus),
    includeClosed: input.includeClosed === true,
  });
  return { drafts: result.drafts, skipped: result.skipped, errors: result.errors };
}

/**
 * Trello cards -> build tasks. Keyed on the Trello card id via `import_uid`-less
 * dedupe: we match on the provenance line already stored in `notes`, so
 * re-importing the same board updates nothing and inserts nothing.
 */
export async function commitTrelloBoard(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    content: string;
    listStatus?: unknown;
    includeClosed?: boolean;
    seasonYear: number;
  },
): Promise<{
  written: number;
  duplicates: number;
  skipped: Array<{ ref: string; reason: string }>;
  errors: Array<{ ref: string; message: string }>;
}> {
  const result = trelloCardsToTaskDrafts({
    content: input.content,
    listStatus: readListStatusMap(input.listStatus),
    includeClosed: input.includeClosed === true,
  });
  let written = 0;
  let duplicates = 0;
  for (const draft of result.drafts) {
    const notes = [
      draft.body ?? "",
      "",
      `Imported from Trello list "${draft.payload.listName}" at ${draft.provenance.importedAt}.`,
      // The card id is the dedupe marker: it is what makes a re-import a no-op.
      `Trello card: ${draft.idempotencyKey}`,
    ]
      .join("\n")
      .trim();
    const inserted = await client.query(
      `INSERT INTO build_tasks
         (org_id, title, subsystem, status, notes, due_on, season_year, created_by)
       SELECT $1::uuid, $2, $3, $4, $5, $6::date, $7, $8::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM build_tasks
         WHERE org_id = $1::uuid AND notes LIKE '%' || $9 || '%'
       )`,
      [
        input.orgId,
        draft.title.slice(0, 200),
        draft.payload.subsystem,
        draft.payload.status,
        notes.slice(0, 8000),
        draft.payload.dueOn,
        input.seasonYear,
        input.userId,
        `Trello card: ${draft.idempotencyKey}`,
      ],
    );
    if (inserted.rowCount) written += 1;
    else duplicates += 1;
  }
  return { written, duplicates, skipped: result.skipped, errors: result.errors };
}

/* -------------------------------------------------------------------------- *
 * STIMS roster -> reviewed invite list
 * -------------------------------------------------------------------------- */

export function previewStimsRoster(content: string) {
  const result = stimsRosterToInviteDrafts({ content });
  return {
    drafts: result.drafts.map((draft) => ({ email: draft.email, personName: draft.personName })),
    skipped: result.skipped,
    errors: result.errors,
  };
}

export type InviteCommitResult = {
  invited: number;
  failed: Array<{ email: string; reason: string }>;
  /** Delivery is reported per invite so an unconfigured mailer is visible. */
  emailsSent: number;
};

/**
 * Send the reviewed invite list through the EXISTING invite machinery, one
 * `createOrganizationInvite` per row, so capability checks, owner-role rules,
 * token hashing, and the membership audit trail all apply exactly as they do
 * for a hand-typed invite. Only the rows the owner explicitly confirmed are
 * passed in — parsing a roster never sends anything.
 */
export async function commitInviteDrafts(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    /** Emails the owner ticked in the review step. */
    emails: string[];
    role: OrgRole;
    sendEmail: boolean;
  },
): Promise<InviteCommitResult> {
  const result: InviteCommitResult = { invited: 0, failed: [], emailsSent: 0 };
  const seen = new Set<string>();
  for (const raw of input.emails) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    try {
      // Per-email savepoint. One duplicate address raises a unique violation,
      // which aborts the transaction — so the plain catch recorded that email as
      // failed and then every remaining invite failed too, with "current
      // transaction is aborted" as its reason, and none of the invites already
      // created survived the COMMIT. The owner saw an import that reported
      // partial success and delivered nothing.
      const invite = await withSavepointOrThrow(client, () =>
        createOrganizationInvite(client, input.userId, {
          orgId: input.orgId,
          email,
          role: input.role,
        }),
      );
      result.invited += 1;
      if (input.sendEmail) {
        const delivery = await deliverInviteEmail(invite);
        if (delivery.emailSent) result.emailsSent += 1;
      }
    } catch (error) {
      result.failed.push({
        email,
        reason: error instanceof Error ? error.message : "the invite could not be created",
      });
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- *
 * Saved CSV column-mapping presets (migration 0465)
 * -------------------------------------------------------------------------- */

export type ImportPresetRow = {
  id: string;
  connector: string;
  name: string;
  columns: Record<string, ColumnGuess>;
};

export async function listImportPresets(
  client: PoolClient,
  input: { orgId: string; connector?: string },
): Promise<ImportPresetRow[]> {
  const rows = await client.query<ImportPresetRow>(
    `SELECT id, connector, name, columns
     FROM import_mapping_presets
     WHERE org_id = $1::uuid AND ($2::text IS NULL OR connector = $2)
     ORDER BY connector, name`,
    [input.orgId, input.connector ?? null],
  );
  return rows.rows;
}

export async function saveImportPreset(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    connector: string;
    name: string;
    columns: Record<string, ColumnGuess>;
  },
): Promise<ImportPresetRow> {
  const name = input.name.trim();
  if (!name) throw new Error("Give the preset a name so you can find it next week");
  const columns = presetColumnsFromMapping(input.columns);
  if (!Object.keys(columns).length) {
    throw new Error("Map at least one column before saving a preset");
  }
  const saved = await client.query<ImportPresetRow>(
    `INSERT INTO import_mapping_presets (org_id, connector, name, columns, created_by)
     VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)
     ON CONFLICT (org_id, connector, name)
     DO UPDATE SET columns = EXCLUDED.columns, updated_at = now()
     RETURNING id, connector, name, columns`,
    [input.orgId, input.connector, name.slice(0, 120), JSON.stringify(columns), input.userId],
  );
  return saved.rows[0]!;
}

export async function deleteImportPreset(
  client: PoolClient,
  input: { orgId: string; presetId: string },
): Promise<number> {
  const removed = await client.query(
    `DELETE FROM import_mapping_presets WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.presetId],
  );
  return removed.rowCount ?? 0;
}

/**
 * Header row -> a proposed mapping. When a preset is named it is applied first
 * and every difference from the file is reported; otherwise the headers are
 * auto-detected. Both paths are SUGGESTIONS the user confirms before commit.
 */
export async function previewCsvMapping(
  client: PoolClient,
  input: { orgId: string; content: string; connector: string; presetId?: string },
) {
  const headers = parseCsvHeaders(input.content);
  if (!input.presetId) {
    return {
      headers,
      columns: autoDetectColumns(headers),
      preset: null,
      missingHeaders: [] as string[],
      unknownHeaders: [] as string[],
      presets: await listImportPresets(client, { orgId: input.orgId, connector: input.connector }),
    };
  }
  const rows = await client.query<ImportPresetRow>(
    `SELECT id, connector, name, columns FROM import_mapping_presets
     WHERE org_id = $1::uuid AND id = $2::uuid`,
    [input.orgId, input.presetId],
  );
  const found = rows.rows[0];
  if (!found) throw new Error("That mapping preset no longer exists");
  const preset: MappingPreset = { id: found.id, name: found.name, columns: found.columns };
  const applied = applyPreset(preset, headers);
  return {
    headers,
    columns: applied.columns,
    preset: { id: found.id, name: found.name },
    missingHeaders: applied.missingHeaders,
    unknownHeaders: applied.unknownHeaders,
    presets: await listImportPresets(client, { orgId: input.orgId, connector: input.connector }),
  };
}

export async function commitNotionJson(
  client: PoolClient,
  input: { orgId: string; userId: string; content: string; seasonYear: number },
): Promise<{ calendar: number; knowledge: number; tasks: number }> {
  const drafts = previewNotionJson(input.content);
  const calendar = await commitIcsDrafts(client, { orgId: input.orgId, userId: input.userId, drafts });
  const knowledge = await commitKnowledgeDrafts(client, { orgId: input.orgId, userId: input.userId, drafts });
  const tasks = await commitTaskDrafts(client, {
    orgId: input.orgId,
    userId: input.userId,
    drafts,
    seasonYear: input.seasonYear,
  });
  return { calendar, knowledge, tasks };
}
