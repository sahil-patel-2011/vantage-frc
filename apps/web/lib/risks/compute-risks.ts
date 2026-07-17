import type { PoolClient } from "@neondatabase/serverless";
import { evaluateRisk, riskMatrix, summarizeRisks } from ".";
import type { MatrixCell, RiskCategory, RiskEvaluation, RiskStatus, RiskSummary, TeamRisk } from "./types";

export const RISK_CATEGORIES: RiskCategory[] = [
  "technical",
  "schedule",
  "funding",
  "logistics",
  "safety",
  "people",
  "other",
];
export const RISK_STATUSES: RiskStatus[] = ["open", "mitigating", "monitoring", "accepted", "closed"];

export type RisksSetupStep = { id: string; label: string; detail: string; href: string };

export type RisksView =
  | {
      status: "setup_required";
      message: string;
      steps: RisksSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      evaluations: RiskEvaluation[];
      summary: RiskSummary;
      matrix: MatrixCell[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type RiskRow = {
  id: string;
  title: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  status: RiskStatus;
  mitigation: string | null;
  owner: string | null;
  dueOn: string | null;
  notes: string | null;
  seasonYear: number;
};

function mapRisk(row: RiskRow): TeamRisk {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    likelihood: Number(row.likelihood) || 1,
    impact: Number(row.impact) || 1,
    status: row.status,
    mitigation: row.mitigation,
    owner: row.owner,
    dueOn: row.dueOn,
    notes: row.notes,
    seasonYear: row.seasonYear,
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

export async function computeRisksView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<RisksView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build the season risk register.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [riskResult, seasonResult] = await Promise.all([
    client.query<RiskRow>(
      `SELECT id, title, category, likelihood, impact, status, mitigation, owner,
              due_on::text AS "dueOn", notes, season_year AS "seasonYear"
       FROM risk_register
       WHERE org_id = $1 AND season_year = $2
       ORDER BY (likelihood * impact) DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM risk_register WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const risks = riskResult.rows.map(mapRisk);
  const evaluations = risks.map((risk) => evaluateRisk(risk));
  const summary = summarizeRisks(risks);
  const matrix = riskMatrix(risks);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    evaluations,
    summary,
    matrix,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

function clampScale(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value || 1)));
}

export async function createRisk(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    category: RiskCategory;
    likelihood: number;
    impact: number;
    status: RiskStatus;
    mitigation: string | null;
    owner: string | null;
    dueOn: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO risk_register
       (org_id, season_year, title, category, likelihood, impact, status, mitigation, owner, due_on, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.category,
      clampScale(input.likelihood),
      clampScale(input.impact),
      input.status,
      input.mitigation,
      input.owner,
      input.dueOn,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateRisk(
  client: PoolClient,
  input: {
    orgId: string;
    riskId: string;
    title?: string;
    category?: RiskCategory;
    likelihood?: number;
    impact?: number;
    status?: RiskStatus;
    mitigation?: string | null;
    owner?: string | null;
    dueOn?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE risk_register SET
       title = COALESCE($3, title),
       category = COALESCE($4, category),
       likelihood = COALESCE($5, likelihood),
       impact = COALESCE($6, impact),
       status = COALESCE($7, status),
       mitigation = CASE WHEN $8::boolean THEN $9 ELSE mitigation END,
       owner = CASE WHEN $10::boolean THEN $11 ELSE owner END,
       due_on = CASE WHEN $12::boolean THEN $13::date ELSE due_on END,
       notes = CASE WHEN $14::boolean THEN $15 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.riskId,
      input.orgId,
      input.title ?? null,
      input.category ?? null,
      input.likelihood == null ? null : clampScale(input.likelihood),
      input.impact == null ? null : clampScale(input.impact),
      input.status ?? null,
      input.mitigation !== undefined,
      input.mitigation ?? null,
      input.owner !== undefined,
      input.owner ?? null,
      input.dueOn !== undefined,
      input.dueOn ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteRisk(
  client: PoolClient,
  input: { orgId: string; riskId: string },
): Promise<void> {
  await client.query(`DELETE FROM risk_register WHERE id = $1 AND org_id = $2`, [input.riskId, input.orgId]);
}
