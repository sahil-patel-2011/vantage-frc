import type { PoolClient } from "@neondatabase/serverless";
import { importScoutData } from "@vantage/scouting";
import { ScoutingRepository } from "@vantage/scouting/repository";
import {
  hoursDraftsFromCsv,
  icsEventsToDrafts,
  notionPagesToDrafts,
  parseIcs,
  parseCsvHeaders,
  suggestColumnMap,
  type ImportDraft,
  type NotionPage,
} from "@vantage/import";
import { slugifyTitle } from "../knowledge/helpers";

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
