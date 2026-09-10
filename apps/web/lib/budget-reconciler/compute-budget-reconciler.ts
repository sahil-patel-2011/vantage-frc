import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { DEFAULT_WEIGHT_LIMIT_LBS } from "../weight-budget";
import { computeCurrentReading, computeMassReading, proposeTrimSubsystem, trimConfidence } from ".";
import type { BudgetReconcilerReport, BudgetStatus, CurrentReading, MassReading, SubsystemContribution, TrimProposal } from "./types";

export type BudgetReconcilerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type BudgetReconcilerView =
  | {
      status: "setup_required";
      message: string;
      steps: BudgetReconcilerSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      subsystems: SubsystemContribution[];
      mass: MassReading;
      current: CurrentReading;
      trimProposal: TrimProposal | null;
      reports: BudgetReconcilerReport[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
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

type MassRow = { subsystem: string; massLbs: string };
type CurrentRow = { subsystem: string; currentAmps: string };
type ReportRow = {
  id: string;
  seasonYear: number;
  massTotalLbs: string;
  massLimitLbs: string;
  massDriftLbs: string;
  massStatus: string;
  currentTotalAmps: string;
  currentBreakerAmps: string;
  currentDriftAmps: string;
  currentStatus: string;
  trimSubsystem: string | null;
  trimAmountLbs: string | null;
  rationale: string;
  confidence: string;
  createdAt: string;
};

function isStatus(value: unknown): value is BudgetStatus {
  return value === "over" || value === "under" || value === "on_target";
}

function mapReport(row: ReportRow): BudgetReconcilerReport {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    massTotalLbs: Number(row.massTotalLbs) || 0,
    massLimitLbs: Number(row.massLimitLbs) || 0,
    massDriftLbs: Number(row.massDriftLbs) || 0,
    massStatus: isStatus(row.massStatus) ? row.massStatus : "on_target",
    currentTotalAmps: Number(row.currentTotalAmps) || 0,
    currentBreakerAmps: Number(row.currentBreakerAmps) || 0,
    currentDriftAmps: Number(row.currentDriftAmps) || 0,
    currentStatus: isStatus(row.currentStatus) ? row.currentStatus : "on_target",
    trimSubsystem: row.trimSubsystem,
    trimAmountLbs: row.trimAmountLbs != null ? Number(row.trimAmountLbs) || 0 : null,
    rationale: row.rationale,
    confidence: Number(row.confidence) || 0,
    createdAt: row.createdAt,
  };
}

async function loadSubsystemContributions(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<SubsystemContribution[]> {
  const [massResult, currentResult] = await Promise.all([
    client.query<MassRow>(
      `SELECT COALESCE(NULLIF(subsystem, ''), 'Unassigned') AS subsystem,
              SUM(weight_lbs * quantity)::text AS "massLbs"
       FROM weight_components
       WHERE org_id = $1 AND season_year = $2
       GROUP BY 1`,
      [orgId, seasonYear],
    ),
    client.query<CurrentRow>(
      `SELECT COALESCE(NULLIF(subsystem, ''), 'Unassigned') AS subsystem,
              SUM(COALESCE(typical_amps, 0))::text AS "currentAmps"
       FROM power_loads
       WHERE org_id = $1 AND season_year = $2
       GROUP BY 1`,
      [orgId, seasonYear],
    ),
  ]);

  const bySubsystem = new Map<string, SubsystemContribution>();
  for (const row of massResult.rows) {
    bySubsystem.set(row.subsystem, { subsystem: row.subsystem, massLbs: Number(row.massLbs) || 0, currentAmps: 0 });
  }
  for (const row of currentResult.rows) {
    const existing = bySubsystem.get(row.subsystem);
    if (existing) {
      existing.currentAmps = Number(row.currentAmps) || 0;
    } else {
      bySubsystem.set(row.subsystem, { subsystem: row.subsystem, massLbs: 0, currentAmps: Number(row.currentAmps) || 0 });
    }
  }
  return Array.from(bySubsystem.values()).sort((a, b) => b.massLbs - a.massLbs);
}

export async function computeBudgetReconcilerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<BudgetReconcilerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to reconcile the weight/power budget.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [subsystems, limitResult, breakerResult, seasonResult, reportResult] = await Promise.all([
    loadSubsystemContributions(client, org.orgId, seasonYear),
    client.query<{ limitLbs: string }>(
      `SELECT limit_lbs::text AS "limitLbs" FROM weight_settings WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<{ breakerAmps: string }>(
      `SELECT COALESCE(SUM(breaker_amps), 0)::text AS "breakerAmps"
       FROM power_loads WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM weight_components WHERE org_id = $1
       UNION SELECT DISTINCT season_year FROM power_loads WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
    client.query<ReportRow>(
      `SELECT id, season_year AS "seasonYear", mass_total_lbs AS "massTotalLbs",
              mass_limit_lbs AS "massLimitLbs", mass_drift_lbs AS "massDriftLbs", mass_status AS "massStatus",
              current_total_amps AS "currentTotalAmps", current_breaker_amps AS "currentBreakerAmps",
              current_drift_amps AS "currentDriftAmps", current_status AS "currentStatus",
              trim_subsystem AS "trimSubsystem", trim_amount_lbs AS "trimAmountLbs",
              rationale, confidence, created_at AS "createdAt"
       FROM budget_reconciler_reports
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [org.orgId, seasonYear],
    ),
  ]);

  const massTotal = subsystems.reduce((sum, s) => sum + s.massLbs, 0);
  const massLimit = Number(limitResult.rows[0]?.limitLbs ?? DEFAULT_WEIGHT_LIMIT_LBS) || DEFAULT_WEIGHT_LIMIT_LBS;
  const currentTotal = subsystems.reduce((sum, s) => sum + s.currentAmps, 0);
  const breakerTotal = Number(breakerResult.rows[0]?.breakerAmps ?? 0) || 0;

  const mass = computeMassReading(massTotal, massLimit);
  const current = computeCurrentReading(currentTotal, breakerTotal);
  const trimProposal = proposeTrimSubsystem(subsystems, mass);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    subsystems,
    mass,
    current,
    trimProposal,
    reports: reportResult.rows.map(mapReport),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Snapshot the current mass/current drift against target and persist a trim proposal.
 * The trim math is fully deterministic (proposeTrimSubsystem); meteredAI wraps it so the run is
 * billed and audited through the standard usage-ledger path, matching every other metered feature.
 */
export async function runReconciliation(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<BudgetReconcilerReport> {
  const subsystems = await loadSubsystemContributions(client, input.orgId, input.seasonYear);
  const [limitResult, breakerResult] = await Promise.all([
    client.query<{ limitLbs: string }>(
      `SELECT limit_lbs::text AS "limitLbs" FROM weight_settings WHERE org_id = $1 AND season_year = $2`,
      [input.orgId, input.seasonYear],
    ),
    client.query<{ breakerAmps: string }>(
      `SELECT COALESCE(SUM(breaker_amps), 0)::text AS "breakerAmps"
       FROM power_loads WHERE org_id = $1 AND season_year = $2`,
      [input.orgId, input.seasonYear],
    ),
  ]);

  const massTotal = subsystems.reduce((sum, s) => sum + s.massLbs, 0);
  const massLimit = Number(limitResult.rows[0]?.limitLbs ?? DEFAULT_WEIGHT_LIMIT_LBS) || DEFAULT_WEIGHT_LIMIT_LBS;
  const currentTotal = subsystems.reduce((sum, s) => sum + s.currentAmps, 0);
  const breakerTotal = Number(breakerResult.rows[0]?.breakerAmps ?? 0) || 0;

  const mass = computeMassReading(massTotal, massLimit);
  const current = computeCurrentReading(currentTotal, breakerTotal);

  const result = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "budget_reconciler",
    requestId: `budget-reconciler-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      seasonYear: input.seasonYear,
      subsystemCount: subsystems.length,
      note: "Deterministic mass/current drift + trim proposal — no external model call",
    },
    invoke: async () => {
      const trimProposal = proposeTrimSubsystem(subsystems, mass);
      const confidence = trimConfidence(trimProposal, mass);
      return {
        value: { trimProposal, confidence },
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-budget-reconciler-v1",
        provider: "vantage-local",
      };
    },
  });

  const { trimProposal, confidence } = result;
  const rationale =
    trimProposal?.rationale ??
    (mass.status === "over"
      ? "Mass is over budget but no subsystem has recorded weight_components to trim — log component weights by subsystem to get a trim proposal."
      : current.status === "over"
        ? "Current draw exceeds the summed breaker budget. Review breaker sizing or reduce peak-draw subsystems."
        : "Mass and current are both within target — no trim needed.");

  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO budget_reconciler_reports (
       org_id, season_year, mass_total_lbs, mass_limit_lbs, mass_drift_lbs, mass_status,
       current_total_amps, current_breaker_amps, current_drift_amps, current_status,
       trim_subsystem, trim_amount_lbs, rationale, confidence, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id, created_at AS "createdAt"`,
    [
      input.orgId,
      input.seasonYear,
      mass.totalLbs,
      mass.limitLbs,
      mass.driftLbs,
      mass.status,
      current.totalAmps,
      current.breakerAmps,
      current.driftAmps,
      current.status,
      trimProposal?.subsystem ?? null,
      trimProposal?.recommendedTrimLbs ?? null,
      rationale,
      confidence,
      input.userId,
    ],
  );

  return {
    id: inserted.rows[0]!.id,
    seasonYear: input.seasonYear,
    massTotalLbs: mass.totalLbs,
    massLimitLbs: mass.limitLbs,
    massDriftLbs: mass.driftLbs,
    massStatus: mass.status,
    currentTotalAmps: current.totalAmps,
    currentBreakerAmps: current.breakerAmps,
    currentDriftAmps: current.driftAmps,
    currentStatus: current.status,
    trimSubsystem: trimProposal?.subsystem ?? null,
    trimAmountLbs: trimProposal?.recommendedTrimLbs ?? null,
    rationale,
    confidence,
    createdAt: inserted.rows[0]!.createdAt,
  };
}

export async function deleteReport(client: PoolClient, input: { orgId: string; reportId: string }): Promise<void> {
  await client.query(`DELETE FROM budget_reconciler_reports WHERE id = $1 AND org_id = $2`, [
    input.reportId,
    input.orgId,
  ]);
}
