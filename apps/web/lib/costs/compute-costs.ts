import type { PoolClient } from "@neondatabase/serverless";
import { recordMoney, removeMoney } from "../finance/ledger";
import { budgetInsights, combineAllCosts, summarizeCosts, summarizeSubscriptions } from ".";
import type {
  AllCostsSummary,
  BudgetInsight,
  CostCategory,
  CostStatus,
  CostSummary,
  SeasonBudget,
  SeasonCost,
  SeasonSubscription,
  SubscriptionCadence,
  SubscriptionsSummary,
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
export const SUBSCRIPTION_CADENCES: SubscriptionCadence[] = ["monthly", "annual", "one_time"];

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
      /**
       * False for everyone below mentor level. Since 0621 `season_budgets` is
       * `manage_budget`-capability-only in RLS, so `budget.totalBudgetUsd` comes back
       * null for a student whether or not one is set. Without this flag the page
       * would tell them "no budget set", which is a different claim and may be
       * untrue. Costs themselves stay visible to the whole team.
       */
      canManageBudget: boolean;
      costs: SeasonCost[];
      summary: CostSummary;
      subscriptions: SubscriptionsSummary;
      /** The app's own AI/API usage cost for the season (from the usage ledger). */
      apiUsageUsd: number;
      /** Everything added up: season purchases + subscriptions + API usage. */
      allCosts: AllCostsSummary;
      /** Automated finance-assistant output, or null when the org has not opted in. */
      insight: BudgetInsight | null;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type BudgetRow = { totalBudgetUsd: string | number | null; aiAssistEnabled: boolean; notes: string | null };
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
type SubscriptionRow = {
  id: string;
  name: string;
  provider: string | null;
  amountUsd: string | number | null;
  cadence: SubscriptionCadence;
  active: boolean;
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

function mapSubscription(row: SubscriptionRow): SeasonSubscription {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    amountUsd: num(row.amountUsd),
    cadence: row.cadence,
    active: Boolean(row.active),
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
      message: "Choose your team to track season costs and budget.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [budgetAccessResult, budgetResult, costResult, subscriptionResult, apiUsageResult, seasonResult] = await Promise.all([
    client.query<{ allowed: boolean }>(
      `SELECT has_org_capability($1::uuid, 'manage_budget'::org_capability) AS allowed`,
      [org.orgId],
    ),
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
    client.query<SubscriptionRow>(
      `SELECT id, name, provider, amount_usd AS "amountUsd", cadence, active, notes
       FROM season_subscriptions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY active DESC, name`,
      [org.orgId, seasonYear],
    ),
    // The app's own AI/API usage cost for the season, from the shared usage ledger.
    client.query<{ usd: string }>(
      `SELECT COALESCE(sum(cost_usd), 0)::text AS usd
       FROM ai_usage_events
       WHERE org_id = $1
         AND created_at >= make_date($2::int, 1, 1)
         AND created_at < make_date($2::int + 1, 1, 1)`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM (
         SELECT season_year FROM season_budgets WHERE org_id = $1
         UNION SELECT season_year FROM season_costs WHERE org_id = $1
         UNION SELECT season_year FROM season_subscriptions WHERE org_id = $1
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
  const subscriptions = summarizeSubscriptions(subscriptionResult.rows.map(mapSubscription));
  const apiUsageUsd = Math.round(num(apiUsageResult.rows[0]?.usd ?? 0) * 100) / 100;
  const allCosts = combineAllCosts({
    seasonCommitted: summary.totalCommitted,
    subscriptionsAnnual: subscriptions.totalAnnual,
    apiUsageUsd,
  });
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
    canManageBudget: budgetAccessResult.rows[0]?.allowed === true,
    costs,
    summary,
    subscriptions,
    apiUsageUsd,
    allCosts,
    insight,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Mirror a season cost onto the unified money ledger (0461_money_unify.sql).
 * Only PAID rows are money out; a planned row (or one flipped back to planned)
 * removes its mirror. Runs in the caller's transaction so the ledger can never
 * drift from season_costs; the (org, 'season_cost', cost id) upsert key keeps
 * repeat calls idempotent. createdBy is left to current_app_user_id() because
 * update/delete callers do not carry the acting user.
 */
async function mirrorSeasonCost(
  client: PoolClient,
  cost: {
    orgId: string;
    costId: string;
    seasonYear: number;
    label: string;
    amountUsd: number;
    vendor: string | null;
    incurredOn: string;
    status: CostStatus;
    userId?: string;
  },
): Promise<void> {
  if (cost.status === "paid" && cost.amountUsd > 0) {
    await recordMoney(client, {
      orgId: cost.orgId,
      source: "season_cost",
      sourceId: cost.costId,
      direction: "out",
      amountUsd: cost.amountUsd,
      seasonYear: cost.seasonYear,
      label: `Season cost — ${cost.label}${cost.vendor ? ` (${cost.vendor})` : ""}`,
      occurredAt: cost.incurredOn,
      createdBy: cost.userId ?? null,
    });
  } else {
    await removeMoney(client, { orgId: cost.orgId, source: "season_cost", sourceId: cost.costId });
  }
}

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
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO season_costs (org_id, season_year, label, category, amount_usd, vendor, incurred_on, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5::numeric,$6,$7::date,$8,$9,$10)
     RETURNING id`,
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
  const costId = inserted.rows[0]?.id;
  if (costId && input.status === "paid") {
    await mirrorSeasonCost(client, {
      orgId: input.orgId,
      costId,
      seasonYear: input.seasonYear,
      label: input.label,
      amountUsd: Math.max(0, input.amountUsd),
      vendor: input.vendor,
      incurredOn: input.incurredOn,
      status: input.status,
      userId: input.userId,
    });
  }
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
  const updated = await client.query<{
    seasonYear: number;
    label: string;
    amountUsd: string;
    vendor: string | null;
    incurredOn: string;
    status: CostStatus;
  }>(
    `UPDATE season_costs SET
       label = COALESCE($3, label),
       category = COALESCE($4, category),
       amount_usd = COALESCE($5::numeric, amount_usd),
       vendor = CASE WHEN $6::boolean THEN $7 ELSE vendor END,
       incurred_on = COALESCE($8::date, incurred_on),
       status = COALESCE($9, status),
       notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2
     RETURNING season_year AS "seasonYear", label, amount_usd::text AS "amountUsd", vendor,
               incurred_on::text AS "incurredOn", status`,
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
  const row = updated.rows[0];
  if (row) {
    // Re-mirror from the row the DB actually holds — paid rows upsert their
    // ledger entry, planned rows drop it (see mirrorSeasonCost).
    await mirrorSeasonCost(client, {
      orgId: input.orgId,
      costId: input.costId,
      seasonYear: row.seasonYear,
      label: row.label,
      amountUsd: num(row.amountUsd),
      vendor: row.vendor,
      incurredOn: row.incurredOn,
      status: row.status,
    });
  }
}

export async function deleteCost(
  client: PoolClient,
  input: { orgId: string; costId: string },
): Promise<void> {
  await client.query(`DELETE FROM season_costs WHERE id = $1 AND org_id = $2`, [input.costId, input.orgId]);
  // Deleting the cost deletes its money — drop the unified-ledger mirror too.
  await removeMoney(client, { orgId: input.orgId, source: "season_cost", sourceId: input.costId });
}

export async function addSubscription(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    name: string;
    provider: string | null;
    amountUsd: number;
    cadence: SubscriptionCadence;
    active: boolean;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO season_subscriptions (org_id, season_year, name, provider, amount_usd, cadence, active, notes, created_by)
     VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.seasonYear,
      input.name,
      input.provider,
      Math.max(0, input.amountUsd),
      input.cadence,
      input.active,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateSubscription(
  client: PoolClient,
  input: {
    orgId: string;
    subscriptionId: string;
    name?: string;
    provider?: string | null;
    amountUsd?: number;
    cadence?: SubscriptionCadence;
    active?: boolean;
    notes?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE season_subscriptions SET
       name = COALESCE($3, name),
       provider = CASE WHEN $4::boolean THEN $5 ELSE provider END,
       amount_usd = COALESCE($6::numeric, amount_usd),
       cadence = COALESCE($7, cadence),
       active = COALESCE($8, active),
       notes = CASE WHEN $9::boolean THEN $10 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.subscriptionId,
      input.orgId,
      input.name ?? null,
      input.provider !== undefined,
      input.provider ?? null,
      input.amountUsd ?? null,
      input.cadence ?? null,
      input.active ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteSubscription(
  client: PoolClient,
  input: { orgId: string; subscriptionId: string },
): Promise<void> {
  await client.query(`DELETE FROM season_subscriptions WHERE id = $1 AND org_id = $2`, [
    input.subscriptionId,
    input.orgId,
  ]);
}
