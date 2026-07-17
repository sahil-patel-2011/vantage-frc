import type { PoolClient } from "@neondatabase/serverless";
import { budgetInsights, summarizeCosts } from ".";
import type {
  BudgetInsight,
  CostCategory,
  CostStatus,
  CostSummary,
  SeasonBudget,
  SeasonCost,
} from "./types";

export const COST_CATEGORIES: CostCategory[] = [
  "registration",
  "event_fee",
  "parts",
  "materials",
  "tools",
  "travel",
  "marketing",
  "safety",
  "field",
  "other",
];
export const COST_STATUSES: CostStatus[] = ["planned", "paid"];

export type CostsSetupStep = { id: string; label: string; detail: string; href: string };

export type CostsView =
  | {
      status: "setup_required";
      message: string;
      steps: CostsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      budget: SeasonBudget;
      costs: SeasonCost[];
      summary: CostSummary;
      /** Automated finance-assistant output, or null when the org has not opted in. */
      insight: BudgetInsight | null;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type BudgetRow = {
  totalBudgetUsd: string | number | null;
  aiAssistEnabled: boolean;
  notes: string | null;
};

type CostRow = {
  id: string;
  label: string;
  category: CostCategory;
  amountUsd: string | number | null;
  vendor: string | null;
  incurredOn: string;
  status: CostStatus;
  notes: string | null;
};

function num(value: string | number | null): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapCost(row: CostRow): SeasonCost {
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    amountUsd: num(row.amountUsd),
    vendor: row.vendor,
    incurredOn: row.incurredOn,
    status: row.status,
    notes: row.notes,
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

export async function computeCostsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<CostsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track season costs and budget.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [budgetResult, costResult, seasonResult] = await Promise.all([
    client.query<BudgetRow>(
      `SELECT total_budget_usd AS "totalBudgetUsd", ai_assist_enabled AS "aiAssistEnabled", notes
       FROM season_budgets WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<CostRow>(
      `SELECT id, label, category, amount_usd AS "amountUsd", vendor,
              incurred_on::text AS "incurredOn", status, notes
       FROM season_costs
       WHERE org_id = $1 AND season_year = $2
       ORDER BY incurred_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM (
         SELECT season_year FROM season_budgets WHERE org_id = $1
         UNION SELECT season_year FROM season_costs WHERE org_id = $1
       ) s ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const budgetRow = budgetResult.rows[0];
  const budget: SeasonBudget = {
    seasonYear,
    totalBudgetUsd: budgetRow?.totalBudgetUsd == null ? null : num(budgetRow.totalBudgetUsd),
    aiAssistEnabled: Boolean(budgetRow?.aiAssistEnabled),
    notes: budgetRow?.notes ?? null,
  };

  const costs = costResult.rows.map(mapCost);
  const summary = summarizeCosts(costs, budget.totalBudgetUsd);
  const insight = budget.aiAssistEnabled ? budgetInsights(summary, budget) : null;

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    budget,
    costs,
    summary,
    insight,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function setBudget(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    totalBudgetUsd: number | null;
    aiAssistEnabled: boolean;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO season_budgets (org_id, season_year, total_budget_usd, ai_assist_enabled, notes, created_by)
     VALUES ($1, $2, $3::numeric, $4, $5, $6)
     ON CONFLICT (org_id, season_year) DO UPDATE SET
       total_budget_usd = EXCLUDED.total_budget_usd,
       ai_assist_enabled = EXCLUDED.ai_assist_enabled,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    [input.orgId, input.seasonYear, input.totalBudgetUsd, input.aiAssistEnabled, input.notes, input.userId],
  );
}

export async function addCost(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    label: string;
    category: CostCategory;
    amountUsd: number;
    vendor: string | null;
    incurredOn: string;
    status: CostStatus;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO season_costs (org_id, season_year, label, category, amount_usd, vendor, incurred_on, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5::numeric,$6,$7::date,$8,$9,$10)`,
    [
      input.orgId,
      input.seasonYear,
      input.label,
      input.category,
      Math.max(0, input.amountUsd),
      input.vendor,
      input.incurredOn,
      input.status,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateCost(
  client: PoolClient,
  input: {
    orgId: string;
    costId: string;
    label?: string;
    category?: CostCategory;
    amountUsd?: number;
    vendor?: string | null;
    incurredOn?: string;
    status?: CostStatus;
    notes?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE season_costs SET
       label = COALESCE($3, label),
       category = COALESCE($4, category),
       amount_usd = COALESCE($5::numeric, amount_usd),
       vendor = CASE WHEN $6::boolean THEN $7 ELSE vendor END,
       incurred_on = COALESCE($8::date, incurred_on),
       status = COALESCE($9, status),
       notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.costId,
      input.orgId,
      input.label ?? null,
      input.category ?? null,
      input.amountUsd ?? null,
      input.vendor !== undefined,
      input.vendor ?? null,
      input.incurredOn ?? null,
      input.status ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteCost(
  client: PoolClient,
  input: { orgId: string; costId: string },
): Promise<void> {
  await client.query(`DELETE FROM season_costs WHERE id = $1 AND org_id = $2`, [input.costId, input.orgId]);
}
