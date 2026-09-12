import type { PoolClient } from "@neondatabase/serverless";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { computeRiskBurndownSeries, severityBandOf, severityOf, summarizeRisks } from ".";
import type { RiskBurndownPoint, RiskCategory, RiskItem, RiskStatus, RiskSummary } from "./types";

export { RISK_CATEGORIES, RISK_STATUSES, riskCategoryLabel, riskStatusLabel } from ".";

export type RiskBurndownSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO risk metrics. */
function setupStepsFor(orgId: string | null): RiskBurndownSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Risk-Register Burndown.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "risks",
      label: "Open Risks",
      detail: "Season how-likely and how-bad scores stay empty until logged.",
      href: withOrgHref("/risks", orgId),
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Failure modes stay blank until logged.",
      href: hubHref("/team", "fmea", orgId),
    },
  ];
}

export type RiskBurndownView =
  | {
      status: "setup_required";
      message: string;
      steps: RiskBurndownSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      risks: RiskItem[];
      summary: RiskSummary;
      series: RiskBurndownPoint[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type RiskRow = {
  id: string;
  title: string;
  description: string | null;
  category: RiskCategory;
  status: RiskStatus;
  likelihood: number;
  impact: number;
  ownerName: string | null;
  mitigationPlan: string | null;
  identifiedOn: string;
  targetCloseDate: string | null;
  closedOn: string | null;
  seasonYear: number;
  createdAt: string;
};

function mapRisk(row: RiskRow): RiskItem {
  const likelihood = Number(row.likelihood) || 1;
  const impact = Number(row.impact) || 1;
  const severity = severityOf(likelihood, impact);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    likelihood,
    impact,
    severity,
    severityBand: severityBandOf(severity),
    ownerName: row.ownerName,
    mitigationPlan: row.mitigationPlan,
    identifiedOn: row.identifiedOn,
    targetCloseDate: row.targetCloseDate,
    closedOn: row.closedOn,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
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

export async function computeRiskBurndownView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<RiskBurndownView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to track your season risk register.",
      steps: setupStepsFor(null),
      orgId: null,
      seasonYear,
    };
  }

  const [riskResult, seasonResult] = await Promise.all([
    client.query<RiskRow>(
      `SELECT id, title, description, category, status, likelihood, impact,
              owner_name AS "ownerName", mitigation_plan AS "mitigationPlan",
              identified_on::text AS "identifiedOn", target_close_date::text AS "targetCloseDate",
              closed_on::text AS "closedOn", season_year AS "seasonYear",
              created_at::text AS "createdAt"
       FROM risk_burndown_items
       WHERE org_id = $1 AND season_year = $2
       ORDER BY identified_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM risk_burndown_items WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const risks = riskResult.rows.map(mapRisk);
  const summary = summarizeRisks(risks);
  const series = computeRiskBurndownSeries(risks);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    risks,
    summary,
    series,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logRisk(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    description: string | null;
    category: RiskCategory;
    status: RiskStatus;
    likelihood: number;
    impact: number;
    ownerName: string | null;
    mitigationPlan: string | null;
    identifiedOn: string;
    targetCloseDate: string | null;
    closedOn: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO risk_burndown_items (
       org_id, title, description, category, status, likelihood, impact,
       owner_name, mitigation_plan, identified_on, target_close_date, closed_on,
       season_year, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12::date,$13,$14)`,
    [
      input.orgId,
      input.title,
      input.description,
      input.category,
      input.status,
      Math.min(5, Math.max(1, Math.round(input.likelihood))),
      Math.min(5, Math.max(1, Math.round(input.impact))),
      input.ownerName,
      input.mitigationPlan,
      input.identifiedOn,
      input.targetCloseDate,
      input.closedOn,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function updateRiskStatus(
  client: PoolClient,
  input: { orgId: string; riskId: string; status: RiskStatus; closedOn: string | null },
): Promise<void> {
  await client.query(
    `UPDATE risk_burndown_items SET status = $1, closed_on = $2::date WHERE id = $3 AND org_id = $4`,
    [input.status, input.closedOn, input.riskId, input.orgId],
  );
}

export async function deleteRisk(client: PoolClient, input: { orgId: string; riskId: string }): Promise<void> {
  await client.query(`DELETE FROM risk_burndown_items WHERE id = $1 AND org_id = $2`, [
    input.riskId,
    input.orgId,
  ]);
}
