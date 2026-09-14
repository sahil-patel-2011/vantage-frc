import type { PoolClient } from "@neondatabase/serverless";
import { recordMoney, removeMoney } from "../finance/ledger";
import { summarizeBom } from ".";
import type { BomCategory, BomLineItem, BomRollupSummary, BomSource } from "./types";

export type BomCostRollupSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type BomCostRollupView =
  | {
      status: "setup_required";
      message: string;
      steps: BomCostRollupSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      items: BomLineItem[];
      summary: BomRollupSummary;
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

type LineItemRow = {
  id: string;
  partName: string;
  subsystem: string;
  category: BomCategory;
  quantity: number;
  unitCostUsd: string;
  source: BomSource;
  cadReference: string | null;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
};

function mapLineItem(row: LineItemRow): BomLineItem {
  const quantity = Number(row.quantity) || 0;
  const unitCostUsd = Number(row.unitCostUsd) || 0;
  return {
    id: row.id,
    partName: row.partName,
    subsystem: row.subsystem,
    category: row.category,
    quantity,
    unitCostUsd,
    lineTotalUsd: Math.round(quantity * unitCostUsd * 100) / 100,
    source: row.source,
    cadReference: row.cadReference,
    seasonYear: row.seasonYear,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

export async function computeBomCostRollupView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<BomCostRollupView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to track BOM cost against budget.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [itemResult, budgetResult, seasonResult] = await Promise.all([
    client.query<LineItemRow>(
      `SELECT id, part_name AS "partName", subsystem, category, quantity,
              unit_cost_usd AS "unitCostUsd", source, cad_reference AS "cadReference",
              season_year AS "seasonYear", notes, created_at AS "createdAt"
       FROM bom_cost_rollup_line_items
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ budgetUsd: string }>(
      `SELECT budget_usd AS "budgetUsd" FROM bom_cost_rollup_budgets WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM bom_cost_rollup_line_items WHERE org_id = $1
       UNION SELECT DISTINCT season_year FROM bom_cost_rollup_budgets WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
  ]);

  const items = itemResult.rows.map(mapLineItem);
  const budgetUsd = Number(budgetResult.rows[0]?.budgetUsd ?? 0) || 0;
  const summary = summarizeBom(items, budgetUsd);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    items,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addLineItem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    partName: string;
    subsystem: string;
    category: BomCategory;
    quantity: number;
    unitCostUsd: number;
    source: BomSource;
    cadReference: string | null;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  const quantity = Math.max(1, Math.round(input.quantity));
  const unitCostUsd = Math.max(0, input.unitCostUsd);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO bom_cost_rollup_line_items (
       org_id, part_name, subsystem, category, quantity, unit_cost_usd, source, cad_reference,
       season_year, notes, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      input.orgId,
      input.partName,
      input.subsystem,
      input.category,
      quantity,
      unitCostUsd,
      input.source,
      input.cadReference,
      input.seasonYear,
      input.notes,
      input.userId,
    ],
  );
  await recordMoney(client, {
    orgId: input.orgId,
    source: "bom",
    sourceId: inserted.rows[0]!.id,
    direction: "out",
    amountUsd: Math.round(quantity * unitCostUsd * 100) / 100,
    seasonYear: input.seasonYear,
    label: `BOM estimate — ${input.partName}`,
    createdBy: input.userId,
    countsInBalance: false,
  });
}

export async function deleteLineItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM bom_cost_rollup_line_items WHERE id = $1 AND org_id = $2`, [
    input.itemId,
    input.orgId,
  ]);
  await removeMoney(client, { orgId: input.orgId, source: "bom", sourceId: input.itemId });
}

export async function setBudget(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; budgetUsd: number },
): Promise<void> {
  await client.query(
    `INSERT INTO bom_cost_rollup_budgets (org_id, season_year, budget_usd, updated_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id, season_year)
     DO UPDATE SET budget_usd = EXCLUDED.budget_usd, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [input.orgId, input.seasonYear, Math.max(0, input.budgetUsd), input.userId],
  );
}
