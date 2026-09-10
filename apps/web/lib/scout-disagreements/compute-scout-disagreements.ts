import type { PoolClient } from "@neondatabase/serverless";
import { sortDisagreementsForQueue, summarizeDisagreements } from ".";
import type {
  ScoutDisagreement,
  ScoutDisagreementAuditAction,
  ScoutDisagreementAuditEntry,
  ScoutDisagreementStatus,
  ScoutDisagreementSummary,
  ScoutDisagreementValue,
} from "./types";
import { resolveScoutOrg } from "../scout-org-access";
import {
  scoutDisagreementsSetupSteps,
  type ScoutDisagreementsSetupStep,
} from "./scout-disagreements-related";

export const SCOUT_DISAGREEMENT_STATUSES: ScoutDisagreementStatus[] = ["open", "resolved", "dismissed"];

export type { ScoutDisagreementsSetupStep };

export type ScoutDisagreementsView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutDisagreementsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      items: ScoutDisagreement[];
      summary: ScoutDisagreementSummary;
      auditLog: ScoutDisagreementAuditEntry[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type ItemRow = {
  id: string;
  seasonYear: number;
  eventKey: string | null;
  matchNumber: number;
  teamNumber: number;
  fieldKey: string;
  fieldLabel: string;
  values: unknown;
  status: ScoutDisagreementStatus;
  resolvedValue: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

function mapValues(raw: unknown): ScoutDisagreementValue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is { source: unknown; value: unknown } =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      source: typeof entry.source === "string" ? entry.source : "Unknown scout",
      value: typeof entry.value === "string" ? entry.value : String(entry.value ?? ""),
    }))
    .filter((entry) => entry.value.length > 0);
}

function mapItem(row: ItemRow): ScoutDisagreement {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    eventKey: row.eventKey,
    matchNumber: Number(row.matchNumber) || 0,
    teamNumber: Number(row.teamNumber) || 0,
    fieldKey: row.fieldKey,
    fieldLabel: row.fieldLabel,
    values: mapValues(row.values),
    status: row.status,
    resolvedValue: row.resolvedValue,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

type AuditRow = {
  id: string;
  disagreementId: string;
  action: ScoutDisagreementAuditAction;
  previousStatus: ScoutDisagreementStatus | null;
  newStatus: ScoutDisagreementStatus | null;
  resolvedValue: string | null;
  note: string | null;
  createdAt: string;
};

function mapAudit(row: AuditRow): ScoutDisagreementAuditEntry {
  return {
    id: row.id,
    disagreementId: row.disagreementId,
    action: row.action,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    resolvedValue: row.resolvedValue,
    note: row.note,
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

export async function computeScoutDisagreementsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ScoutDisagreementsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to review scouting disagreements.",
      steps: scoutDisagreementsSetupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const [itemResult, seasonResult] = await Promise.all([
    client.query<ItemRow>(
      `SELECT id, season_year AS "seasonYear", event_key AS "eventKey", match_number AS "matchNumber",
              team_number AS "teamNumber", field_key AS "fieldKey", field_label AS "fieldLabel",
              values, status, resolved_value AS "resolvedValue", resolution_note AS "resolutionNote",
              resolved_at::text AS "resolvedAt", created_at::text AS "createdAt"
       FROM scout_disagreements_items
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM scout_disagreements_items WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const items = sortDisagreementsForQueue(itemResult.rows.map(mapItem));
  const summary = summarizeDisagreements(items);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  const itemIds = items.map((item) => item.id);
  const auditResult = itemIds.length
    ? await client.query<AuditRow>(
        `SELECT id, disagreement_id AS "disagreementId", action, previous_status AS "previousStatus",
                new_status AS "newStatus", resolved_value AS "resolvedValue", note,
                created_at::text AS "createdAt"
         FROM scout_disagreements_audit_log
         WHERE org_id = $1 AND disagreement_id = ANY($2::uuid[])
         ORDER BY created_at DESC
         LIMIT 100`,
        [org.orgId, itemIds],
      )
    : { rows: [] as AuditRow[] };

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    items,
    summary,
    auditLog: auditResult.rows.map(mapAudit),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logDisagreement(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    eventKey: string | null;
    matchNumber: number;
    teamNumber: number;
    fieldKey: string;
    fieldLabel: string;
    values: ScoutDisagreementValue[];
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO scout_disagreements_items (
       org_id, season_year, event_key, match_number, team_number, field_key, field_label,
       values, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     RETURNING id`,
    [
      input.orgId,
      input.seasonYear,
      input.eventKey,
      input.matchNumber,
      input.teamNumber,
      input.fieldKey,
      input.fieldLabel,
      JSON.stringify(input.values),
      input.userId,
    ],
  );
  const disagreementId = result.rows[0]?.id;
  if (!disagreementId) throw new Error("Failed to log disagreement");
  await client.query(
    `INSERT INTO scout_disagreements_audit_log (
       org_id, disagreement_id, action, previous_status, new_status, resolved_value, note, actor_id
     ) VALUES ($1,$2,'logged',NULL,'open',NULL,NULL,$3)`,
    [input.orgId, disagreementId, input.userId],
  );
  return disagreementId;
}

async function transitionStatus(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    disagreementId: string;
    action: ScoutDisagreementAuditAction;
    nextStatus: ScoutDisagreementStatus;
    resolvedValue: string | null;
    note: string | null;
  },
): Promise<void> {
  const current = await client.query<{ status: ScoutDisagreementStatus }>(
    `SELECT status FROM scout_disagreements_items WHERE id = $1 AND org_id = $2`,
    [input.disagreementId, input.orgId],
  );
  const previousStatus = current.rows[0]?.status ?? null;
  if (!previousStatus) throw new Error("Disagreement not found");

  await client.query(
    `UPDATE scout_disagreements_items
     SET status = $1,
         resolved_value = $2,
         resolution_note = $3,
         resolved_by = $4,
         resolved_at = CASE WHEN $1 IN ('resolved','dismissed') THEN now() ELSE NULL END
     WHERE id = $5 AND org_id = $6`,
    [input.nextStatus, input.resolvedValue, input.note, input.userId, input.disagreementId, input.orgId],
  );

  await client.query(
    `INSERT INTO scout_disagreements_audit_log (
       org_id, disagreement_id, action, previous_status, new_status, resolved_value, note, actor_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.disagreementId,
      input.action,
      previousStatus,
      input.nextStatus,
      input.resolvedValue,
      input.note,
      input.userId,
    ],
  );
}

export async function resolveDisagreement(
  client: PoolClient,
  input: { orgId: string; userId: string; disagreementId: string; resolvedValue: string; note: string | null },
): Promise<void> {
  await transitionStatus(client, {
    orgId: input.orgId,
    userId: input.userId,
    disagreementId: input.disagreementId,
    action: "resolved",
    nextStatus: "resolved",
    resolvedValue: input.resolvedValue,
    note: input.note,
  });
}

export async function dismissDisagreement(
  client: PoolClient,
  input: { orgId: string; userId: string; disagreementId: string; note: string | null },
): Promise<void> {
  await transitionStatus(client, {
    orgId: input.orgId,
    userId: input.userId,
    disagreementId: input.disagreementId,
    action: "dismissed",
    nextStatus: "dismissed",
    resolvedValue: null,
    note: input.note,
  });
}

export async function reopenDisagreement(
  client: PoolClient,
  input: { orgId: string; userId: string; disagreementId: string; note: string | null },
): Promise<void> {
  await transitionStatus(client, {
    orgId: input.orgId,
    userId: input.userId,
    disagreementId: input.disagreementId,
    action: "reopened",
    nextStatus: "open",
    resolvedValue: null,
    note: input.note,
  });
}
