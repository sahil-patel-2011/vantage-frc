import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { TRIAGE_DECISIONS, TRIAGE_STATUSES, triageRepair } from ".";
import { consumeForSource } from "../parts/store";
import type { FmeaHistoryEntry, SpareCandidate, TriageDecision, TriageReport, TriageStatus } from "./types";

/** A part consumed by a repair, chosen from the unified stock at resolve time. */
export type UsedPart = { itemId: string; quantity: number };

export { TRIAGE_DECISIONS, TRIAGE_STATUSES };

export type PitRepairTriageSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type PitRepairTriageView =
  | {
      status: "setup_required";
      message: string;
      steps: PitRepairTriageSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      reports: TriageReport[];
      fmeaHistory: FmeaHistoryEntry[];
      spareCandidates: SpareCandidate[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isDecision(value: unknown): value is TriageDecision {
  return typeof value === "string" && (TRIAGE_DECISIONS as string[]).includes(value);
}

function isStatus(value: unknown): value is TriageStatus {
  return typeof value === "string" && (TRIAGE_STATUSES as string[]).includes(value);
}

type ReportRow = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  title: string;
  symptomNote: string;
  photoUrl: string | null;
  relatedFmeaFailureId: string | null;
  matchedInventoryItemId: string | null;
  minutesUntilNextMatch: number;
  severity: number;
  priorFailureCount: number;
  sparesAvailable: string;
  decision: string;
  confidence: string;
  rationale: string;
  prestageRecommended: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function mapReport(row: ReportRow): TriageReport {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystemName: row.subsystemName,
    title: row.title,
    symptomNote: row.symptomNote,
    photoUrl: row.photoUrl,
    relatedFmeaFailureId: row.relatedFmeaFailureId,
    matchedInventoryItemId: row.matchedInventoryItemId,
    minutesUntilNextMatch: Number(row.minutesUntilNextMatch) || 0,
    severity: Number(row.severity) || 5,
    priorFailureCount: Number(row.priorFailureCount) || 0,
    sparesAvailable: Number(row.sparesAvailable) || 0,
    decision: isDecision(row.decision) ? row.decision : "fix",
    confidence: Number(row.confidence) || 0,
    rationale: row.rationale,
    prestageRecommended: Boolean(row.prestageRecommended),
    status: isStatus(row.status) ? row.status : "open",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type FmeaRow = {
  id: string;
  title: string;
  subsystemName: string;
  occurredAt: string;
  severity: number;
  occurrence: number;
  detection: number;
  status: string;
};

function mapFmea(row: FmeaRow): FmeaHistoryEntry {
  return {
    id: row.id,
    title: row.title,
    subsystemName: row.subsystemName,
    occurredAt: row.occurredAt,
    severity: Number(row.severity) || 0,
    occurrence: Number(row.occurrence) || 0,
    detection: Number(row.detection) || 0,
    status: row.status,
  };
}

type InventoryRow = {
  id: string;
  name: string;
  category: string;
  quantity: string;
  subsystem: string | null;
};

function mapSpare(row: InventoryRow): SpareCandidate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: Number(row.quantity) || 0,
    subsystem: row.subsystem,
  };
}

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

export async function computePitRepairTriageView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<PitRepairTriageView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to triage pit repairs.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [reportResult, fmeaResult, inventoryResult, seasonResult] = await Promise.all([
    client.query<ReportRow>(
      `SELECT id, season_year AS "seasonYear", subsystem_name AS "subsystemName", title,
              symptom_note AS "symptomNote", photo_url AS "photoUrl",
              related_fmea_failure_id AS "relatedFmeaFailureId",
              matched_inventory_item_id AS "matchedInventoryItemId",
              minutes_until_next_match AS "minutesUntilNextMatch", severity,
              prior_failure_count AS "priorFailureCount", spares_available AS "sparesAvailable",
              decision, confidence, rationale, prestage_recommended AS "prestageRecommended",
              status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM pit_repair_triage_reports
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<FmeaRow>(
      `SELECT id, title, subsystem_name AS "subsystemName", occurred_at::text AS "occurredAt",
              severity, occurrence, detection, status
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_at DESC
       LIMIT 50`,
      [org.orgId, seasonYear],
    ),
    client.query<InventoryRow>(
      `SELECT id, name, category, quantity::text AS quantity, subsystem
       FROM inventory_items
       WHERE org_id = $1 AND archived = false AND quantity > 0
       ORDER BY name
       LIMIT 200`,
      [org.orgId],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM pit_repair_triage_reports WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    reports: reportResult.rows.map(mapReport),
    fmeaHistory: fmeaResult.rows.map(mapFmea),
    spareCandidates: inventoryResult.rows.map(mapSpare),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logFailure(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    subsystemName: string;
    title: string;
    symptomNote: string;
    photoUrl: string | null;
    minutesUntilNextMatch: number;
    relatedFmeaFailureId: string | null;
    matchedInventoryItemId: string | null;
  },
): Promise<void> {
  const [priorFailureResult, fmeaSeverityResult, inventoryResult] = await Promise.all([
    client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2 AND lower(subsystem_name) = lower($3)`,
      [input.orgId, input.seasonYear, input.subsystemName],
    ),
    input.relatedFmeaFailureId
      ? client.query<{ severity: number }>(
          `SELECT severity FROM fmea_failures WHERE id = $1 AND org_id = $2`,
          [input.relatedFmeaFailureId, input.orgId],
        )
      : Promise.resolve({ rows: [] as { severity: number }[] }),
    input.matchedInventoryItemId
      ? client.query<{ quantity: string }>(
          `SELECT quantity::text AS quantity FROM inventory_items WHERE id = $1 AND org_id = $2`,
          [input.matchedInventoryItemId, input.orgId],
        )
      : Promise.resolve({ rows: [] as { quantity: string }[] }),
  ]);

  const priorFailureCount = Number(priorFailureResult.rows[0]?.count ?? 0) || 0;
  const severity = Number(fmeaSeverityResult.rows[0]?.severity ?? 5) || 5;
  const sparesAvailable = Number(inventoryResult.rows[0]?.quantity ?? 0) || 0;

  const triage = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "pit_repair_triage",
    requestId: `pit-repair-triage-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      subsystemName: input.subsystemName,
      seasonYear: input.seasonYear,
      note: "Deterministic minutes/spares/history triage computation — no external model call",
    },
    invoke: async () => ({
      value: triageRepair({
        minutesUntilNextMatch: input.minutesUntilNextMatch,
        sparesAvailable,
        priorFailureCount,
        severity,
      }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-pit-repair-triage-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO pit_repair_triage_reports (
       org_id, season_year, subsystem_name, title, symptom_note, photo_url,
       related_fmea_failure_id, matched_inventory_item_id, minutes_until_next_match, severity,
       prior_failure_count, spares_available, decision, confidence, rationale, prestage_recommended,
       recorded_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      input.orgId,
      input.seasonYear,
      input.subsystemName,
      input.title,
      input.symptomNote,
      input.photoUrl,
      input.relatedFmeaFailureId,
      input.matchedInventoryItemId,
      Math.max(0, Math.round(input.minutesUntilNextMatch)),
      severity,
      priorFailureCount,
      sparesAvailable,
      triage.decision,
      triage.confidence,
      triage.rationale,
      triage.prestageRecommended,
      input.userId,
    ],
  );
}

export async function updateReportStatus(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    reportId: string;
    status: TriageStatus;
    /** Parts consumed by this repair; decremented through the ONE parts ledger on resolve. */
    usedParts?: UsedPart[];
  },
): Promise<void> {
  const updated = await client.query<{ title: string }>(
    `UPDATE pit_repair_triage_reports SET status = $1, updated_at = now()
     WHERE id = $2 AND org_id = $3
     RETURNING title`,
    [input.status, input.reportId, input.orgId],
  );
  if (!updated.rowCount) throw new Error("Report not found");

  // Close the loop: a resolved repair that consumed parts decrements the unified stock through
  // the append-only ledger, keyed to this repair (idempotent — a replay cannot double-decrement).
  if (input.status === "resolved" && input.usedParts?.length) {
    await consumeForSource(client, {
      orgId: input.orgId,
      userId: input.userId,
      sourceKind: "pit_repair_triage",
      sourceId: input.reportId,
      note: `Used by pit repair: ${updated.rows[0]!.title}`,
      items: input.usedParts.map((part) => ({ itemId: part.itemId, quantity: part.quantity })),
    });
  }
}

export async function deleteReport(
  client: PoolClient,
  input: { orgId: string; reportId: string },
): Promise<void> {
  await client.query(`DELETE FROM pit_repair_triage_reports WHERE id = $1 AND org_id = $2`, [
    input.reportId,
    input.orgId,
  ]);
}
