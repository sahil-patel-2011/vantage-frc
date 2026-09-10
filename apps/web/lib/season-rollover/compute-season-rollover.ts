import type { PoolClient } from "@neondatabase/serverless";
import { SEASON_ROLLOVER_CATEGORIES, currentSeasonYear, nextSeasonYear, summarizeRollover } from ".";
import type {
  SeasonRolloverCategory,
  SeasonRolloverItem,
  SeasonRolloverPlan,
  SeasonRolloverStatus,
  SeasonRolloverSummary,
} from "./types";

export type SeasonRolloverSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SeasonRolloverView =
  | {
      status: "setup_required";
      message: string;
      steps: SeasonRolloverSetupStep[];
      orgId: string | null;
      toSeasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      fromSeasonYear: number;
      toSeasonYear: number;
      plans: SeasonRolloverPlan[];
      activePlan: SeasonRolloverPlan | null;
      summary: SeasonRolloverSummary;
      computedAt: string;
    };

type PlanRow = {
  id: string;
  fromSeasonYear: number;
  toSeasonYear: number;
  status: SeasonRolloverStatus;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
};

type ItemRow = {
  id: string;
  planId: string;
  category: SeasonRolloverCategory;
  label: string;
  carried: boolean;
  notes: string | null;
  createdAt: string;
  carriedAt: string | null;
};

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

export async function computeSeasonRolloverView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; toSeasonYear?: number | null },
): Promise<SeasonRolloverView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const toSeasonYear =
    input.toSeasonYear && input.toSeasonYear > 2000 ? input.toSeasonYear : nextSeasonYear(currentSeasonYear());

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to plan your season rollover.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      toSeasonYear,
    };
  }

  const [planResult, itemResult] = await Promise.all([
    client.query<PlanRow>(
      `SELECT id, from_season_year AS "fromSeasonYear", to_season_year AS "toSeasonYear",
              status, notes, created_at::text AS "createdAt", completed_at::text AS "completedAt"
       FROM season_rollover_plans
       WHERE org_id = $1
       ORDER BY to_season_year DESC, created_at DESC`,
      [org.orgId],
    ),
    client.query<ItemRow>(
      `SELECT i.id, i.plan_id AS "planId", i.category, i.label, i.carried, i.notes,
              i.created_at::text AS "createdAt", i.carried_at::text AS "carriedAt"
       FROM season_rollover_items i
       JOIN season_rollover_plans p ON p.id = i.plan_id
       WHERE i.org_id = $1
       ORDER BY i.created_at ASC`,
      [org.orgId],
    ),
  ]);

  const itemsByPlan = new Map<string, SeasonRolloverItem[]>();
  for (const row of itemResult.rows) {
    const category = (SEASON_ROLLOVER_CATEGORIES as string[]).includes(row.category) ? row.category : "other";
    const item: SeasonRolloverItem = {
      id: row.id,
      planId: row.planId,
      category,
      label: row.label,
      carried: row.carried,
      notes: row.notes,
      createdAt: row.createdAt,
      carriedAt: row.carriedAt,
    };
    const list = itemsByPlan.get(row.planId) ?? [];
    list.push(item);
    itemsByPlan.set(row.planId, list);
  }

  const plans: SeasonRolloverPlan[] = planResult.rows.map((row) => ({
    id: row.id,
    fromSeasonYear: row.fromSeasonYear,
    toSeasonYear: row.toSeasonYear,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    items: itemsByPlan.get(row.id) ?? [],
  }));

  const activePlan =
    plans.find((plan) => plan.toSeasonYear === toSeasonYear) ?? plans.find((plan) => plan.status !== "completed") ?? null;

  const summary = summarizeRollover(activePlan?.items ?? []);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    fromSeasonYear: activePlan?.fromSeasonYear ?? currentSeasonYear(),
    toSeasonYear: activePlan?.toSeasonYear ?? toSeasonYear,
    plans,
    activePlan,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createPlan(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    fromSeasonYear: number;
    toSeasonYear: number;
    notes: string | null;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO season_rollover_plans (org_id, from_season_year, to_season_year, notes, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [input.orgId, input.fromSeasonYear, input.toSeasonYear, input.notes, input.userId],
  );
  return result.rows[0]?.id ?? "";
}

export async function addItem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    planId: string;
    category: SeasonRolloverCategory;
    label: string;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO season_rollover_items (org_id, plan_id, category, label, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.orgId, input.planId, input.category, input.label, input.notes, input.userId],
  );
}

export async function setItemCarried(
  client: PoolClient,
  input: { orgId: string; itemId: string; carried: boolean },
): Promise<void> {
  await client.query(
    `UPDATE season_rollover_items
     SET carried = $3, carried_at = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId, input.carried],
  );
}

export async function deleteItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM season_rollover_items WHERE id = $1 AND org_id = $2`, [
    input.itemId,
    input.orgId,
  ]);
}

export async function completePlan(
  client: PoolClient,
  input: { orgId: string; planId: string },
): Promise<void> {
  await client.query(
    `UPDATE season_rollover_plans SET status = 'completed', completed_at = now() WHERE id = $1 AND org_id = $2`,
    [input.planId, input.orgId],
  );
}

export async function deletePlan(
  client: PoolClient,
  input: { orgId: string; planId: string },
): Promise<void> {
  await client.query(`DELETE FROM season_rollover_plans WHERE id = $1 AND org_id = $2`, [
    input.planId,
    input.orgId,
  ]);
}
