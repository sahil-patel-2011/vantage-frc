import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { draftPurchaseRequestLines, forecastExhaustion, PURCHASE_REQUEST_STATUSES, seasonWindow, sortForecastLines } from ".";
import type {
  ExhaustionForecast,
  PurchaseRequestDraft,
  PurchaseRequestLineItem,
  PurchaseRequestStatus,
  SeasonHorizon,
  SpareForecastLine,
} from "./types";

export { PURCHASE_REQUEST_STATUSES };

export type SpareForecastSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SpareForecastView =
  | {
      status: "setup_required";
      message: string;
      steps: SpareForecastSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      /** Real is_spare inventory rows only — never DEMO spare counts. */
      spareBinCount: number;
      /**
       * How many of `spareBinCount` are consumables — the rows /spares manages.
       * Before 0520 this was always 0 by construction, and the two "spares"
       * surfaces shared no data at all.
       */
      consumableSpareCount: number;
      forecastLines: SpareForecastLine[];
      purchaseRequests: PurchaseRequestDraft[];
      /** Closed 200-day window → offseason; remaining-season risk is null, not "no risk". */
      seasonHorizon: SeasonHorizon;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isStatus(value: unknown): value is PurchaseRequestStatus {
  return typeof value === "string" && (PURCHASE_REQUEST_STATUSES as string[]).includes(value);
}

type InventoryRow = {
  id: string;
  name: string;
  kind: string;
  category: string;
  subsystem: string | null;
  quantity: string;
  unitCost: string | null;
  minQuantity: string;
};

type FmeaCountRow = {
  inventoryItemId: string | null;
  subsystemName: string;
  failureCount: string;
};

export type FmeaMatchRow = {
  inventoryItemId?: string | null;
  subsystemName: string;
  failureCount: string | number;
};

export type IndexedFmeaFailures = {
  byItemId: Map<string, number>;
  bySubsystem: Map<string, number>;
};

/**
 * Split FMEA aggregates into item-id counts vs free-text subsystem counts.
 * Rows with inventory_item_id only feed the id map so a linked failure is not
 * also reused by the name join.
 */
export function indexFmeaFailureCounts(rows: FmeaMatchRow[]): IndexedFmeaFailures {
  const byItemId = new Map<string, number>();
  const bySubsystem = new Map<string, number>();
  for (const row of rows) {
    const count = Number(row.failureCount) || 0;
    const itemId = row.inventoryItemId?.trim() ?? "";
    if (itemId) {
      byItemId.set(itemId, (byItemId.get(itemId) ?? 0) + count);
      continue;
    }
    const key = row.subsystemName.trim().toLowerCase();
    if (key) bySubsystem.set(key, (bySubsystem.get(key) ?? 0) + count);
  }
  return { byItemId, bySubsystem };
}

/** Prefer inventory_item_id matches; otherwise the existing subsystem-name join. */
export function failureCountForSpareBin(
  item: { id: string; subsystem: string | null },
  indexed: IndexedFmeaFailures,
): number {
  const byId = indexed.byItemId.get(item.id) ?? 0;
  if (byId > 0) return byId;
  const subsystemKey = (item.subsystem ?? "").trim().toLowerCase();
  return subsystemKey ? (indexed.bySubsystem.get(subsystemKey) ?? 0) : 0;
}

type PurchaseRequestRow = {
  id: string;
  seasonYear: number;
  title: string;
  status: string;
  lineItems: PurchaseRequestLineItem[];
  totalEstimatedCost: string;
  rationale: string;
  createdAt: string;
  updatedAt: string;
};

function mapPurchaseRequest(row: PurchaseRequestRow): PurchaseRequestDraft {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    title: row.title,
    status: isStatus(row.status) ? row.status : "draft",
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
    totalEstimatedCost: Number(row.totalEstimatedCost) || 0,
    rationale: row.rationale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

async function loadForecastLines(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
  asOf: Date = new Date(),
): Promise<{
  spareBinCount: number;
  consumableSpareCount: number;
  forecastLines: SpareForecastLine[];
  seasonHorizon: SeasonHorizon;
}> {
  const { daysElapsed, daysRemaining, horizon } = seasonWindow(seasonYear, asOf);

  const [inventoryResult, fmeaResult] = await Promise.all([
    client.query<InventoryRow>(
      // is_spare, not category = 'spare' (migration 0520). 'spare' was a sibling
      // of 'motor' / 'gearbox' in the 0037 taxonomy, so a team that filed its
      // backup gearbox as a gearbox — which is what the category picker invites —
      // got an empty forecast and no way to tell why. The flag is orthogonal to
      // both category and kind, so a consumable the team holds as a spare (the
      // /spares page's rows) is now forecast alongside spare parts. Those two
      // surfaces could not share a row before: 'spare' is not a consumable
      // category, so `category = 'spare'` and `kind = 'consumable'` were disjoint.
      `SELECT id, name, kind, category, subsystem, quantity::text AS quantity,
              unit_cost::text AS "unitCost", min_quantity::text AS "minQuantity"
       FROM inventory_items
       WHERE org_id = $1 AND archived = false AND is_spare
       ORDER BY name
       LIMIT 200`,
      [orgId],
    ),
    client.query<FmeaCountRow>(
      `SELECT inventory_item_id AS "inventoryItemId",
              subsystem_name AS "subsystemName", count(*)::text AS "failureCount"
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2
       GROUP BY inventory_item_id, subsystem_name`,
      [orgId, seasonYear],
    ),
  ]);

  const indexedFailures = indexFmeaFailureCounts(fmeaResult.rows);

  const lines: SpareForecastLine[] = [];
  for (const row of inventoryResult.rows) {
    const failureCount = failureCountForSpareBin(
      { id: row.id, subsystem: row.subsystem },
      indexedFailures,
    );
    // Skip bins with no matched FMEA history — never fabricate a consumption rate.
    if (failureCount <= 0) continue;
    const quantityOnHand = Number(row.quantity) || 0;
    const unitCost = row.unitCost != null ? Number(row.unitCost) : null;
    const forecast: ExhaustionForecast = forecastExhaustion({
      quantityOnHand,
      failureCount,
      daysElapsed,
      daysRemaining,
    });
    lines.push({
      itemId: row.id,
      itemName: row.name,
      category: row.category,
      subsystem: row.subsystem,
      quantityOnHand,
      failureCount,
      unitCost,
      forecast,
    });
  }
  return {
    spareBinCount: inventoryResult.rows.length,
    consumableSpareCount: inventoryResult.rows.filter((row) => row.kind === "consumable").length,
    forecastLines: sortForecastLines(lines),
    seasonHorizon: horizon,
  };
}

export async function computeSpareForecastView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null; asOf?: Date },
): Promise<SpareForecastView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to forecast spare-parts exhaustion.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        {
          id: "inventory",
          label: "Stock spare parts",
          detail: "Add spare-category items in Inventory so they can be forecast",
          href: "/inventory",
        },
        {
          id: "subsystems",
          label: "Name subsystems",
          detail: "Match spare bin tags to Subsystems so FMEA cadence can apply",
          href: "/subsystems",
        },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [forecastBundle, purchaseRequestResult, seasonResult] = await Promise.all([
    loadForecastLines(client, org.orgId, seasonYear, input.asOf),
    client.query<PurchaseRequestRow>(
      `SELECT id, season_year AS "seasonYear", title, status, line_items AS "lineItems",
              total_estimated_cost AS "totalEstimatedCost", rationale,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM spare_forecast_purchase_requests
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM spare_forecast_purchase_requests WHERE org_id = $1 ORDER BY season_year DESC`,
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
    spareBinCount: forecastBundle.spareBinCount,
    consumableSpareCount: forecastBundle.consumableSpareCount,
    forecastLines: forecastBundle.forecastLines,
    purchaseRequests: purchaseRequestResult.rows.map(mapPurchaseRequest),
    seasonHorizon: forecastBundle.seasonHorizon,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function draftPurchaseRequest(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; title: string; asOf?: Date },
): Promise<void> {
  const { forecastLines } = await loadForecastLines(client, input.orgId, input.seasonYear, input.asOf);

  const drafted = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "spare_forecast",
    requestId: `spare-forecast-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      seasonYear: input.seasonYear,
      candidateCount: forecastLines.length,
      note: "Deterministic FMEA-rate x bin x cadence exhaustion computation — no external model call",
    },
    invoke: async () => ({
      value: draftPurchaseRequestLines(forecastLines),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-spare-forecast-v1",
      provider: "vantage-local",
    }),
  });

  const totalEstimatedCost = drafted.reduce((sum, line) => sum + line.estimatedCost, 0);
  const rationale = drafted.length
    ? `${drafted.length} spare(s) projected to exhaust before season end based on FMEA repeat-failure cadence.`
    : "No spares are currently projected to exhaust before season end.";

  await client.query(
    `INSERT INTO spare_forecast_purchase_requests (
       org_id, season_year, title, line_items, total_estimated_cost, rationale, created_by
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      JSON.stringify(drafted),
      Math.round(totalEstimatedCost * 100) / 100,
      rationale,
      input.userId,
    ],
  );
}

export async function updatePurchaseRequestStatus(
  client: PoolClient,
  input: { orgId: string; requestId: string; status: PurchaseRequestStatus },
): Promise<void> {
  await client.query(
    `UPDATE spare_forecast_purchase_requests SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.requestId, input.orgId],
  );
}

export async function deletePurchaseRequest(
  client: PoolClient,
  input: { orgId: string; requestId: string },
): Promise<void> {
  await client.query(`DELETE FROM spare_forecast_purchase_requests WHERE id = $1 AND org_id = $2`, [
    input.requestId,
    input.orgId,
  ]);
}
