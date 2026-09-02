import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureValue, type RenderOutcome } from "../ai-render/render";
import {
  draftPurchaseRequestLines,
  fmeaRate,
  forecastExhaustion,
  LEDGER_OBSERVATION_WINDOW_DAYS,
  observedRate,
  PURCHASE_REQUEST_STATUSES,
  resolveHorizon,
  seasonDaysElapsed,
  sortForecastLines,
} from ".";
import type {
  ExhaustionForecast,
  ForecastHorizon,
  PurchaseRequestDraft,
  PurchaseRequestLineItem,
  PurchaseRequestStatus,
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
      /** Real spare-category inventory rows only — never DEMO spare counts. */
      spareBinCount: number;
      forecastLines: SpareForecastLine[];
      /** Where the forecast runs to: the next registered event, or an explicit offseason window. */
      horizon: ForecastHorizon;
      /** Trailing window the inventory ledger was sampled over for observed rates. */
      observationWindowDays: number;
      purchaseRequests: PurchaseRequestDraft[];
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
  category: string;
  subsystem: string | null;
  /** robot_subsystems.id matched by name (case-insensitive) — null for free-text-only tags. */
  subsystemId?: string | null;
  quantity: string;
  unitCost: string | null;
  minQuantity: string;
};

type FmeaCountRow = {
  subsystemName: string;
  subsystemId?: string | null;
  failureCount: string;
};

type LedgerUsageRow = {
  itemId: string;
  usedQuantity: string | number;
  eventCount: string | number;
};

type HorizonRow = {
  eventName: string | null;
  endDate: string | null;
};

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

/**
 * Horizon = the org's active event (org_active_context, the same resolution /command uses)
 * joined to events_ref for its end date. A past or missing event yields the explicit
 * offseason branch inside resolveHorizon — never a clamped "0 days remaining".
 */
async function loadHorizon(client: PoolClient, orgId: string, asOf: Date): Promise<ForecastHorizon> {
  const result = await client.query<HorizonRow>(
    `SELECT e.name AS "eventName", e.end_date::text AS "endDate"
     FROM org_active_context c
     JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE c.org_id = $1::uuid
     LIMIT 1`,
    [orgId],
  );
  const row = result.rows[0];
  return resolveHorizon({ asOf, nextEventEndsOn: row?.endDate ?? null, nextEventName: row?.eventName ?? null });
}

async function loadForecastLines(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
  asOf: Date = new Date(),
): Promise<{ spareBinCount: number; forecastLines: SpareForecastLine[]; horizon: ForecastHorizon }> {
  const daysElapsed = seasonDaysElapsed(seasonYear, asOf);

  const [inventoryResult, fmeaResult, ledgerResult, horizon] = await Promise.all([
    // Match each spare bin's subsystem tag to a robot_subsystems row so FMEA rows linked by
    // id count even when the free-text spelling drifted.
    client.query<InventoryRow>(
      `SELECT i.id, i.name, i.category, i.subsystem, i.quantity::text AS quantity,
              i.unit_cost::text AS "unitCost", i.min_quantity::text AS "minQuantity",
              (SELECT rs.id FROM robot_subsystems rs
                WHERE rs.org_id = i.org_id AND lower(rs.name) = lower(i.subsystem)
                ORDER BY rs.season_year DESC LIMIT 1) AS "subsystemId"
       FROM inventory_items i
       WHERE i.org_id = $1::uuid AND i.archived = false AND i.category = 'spare'
       ORDER BY i.name
       LIMIT 200`,
      [orgId],
    ),
    client.query<FmeaCountRow>(
      `SELECT subsystem_name AS "subsystemName", subsystem_id AS "subsystemId", count(*)::text AS "failureCount"
       FROM fmea_failures
       WHERE org_id = $1::uuid AND season_year = $2
       GROUP BY subsystem_name, subsystem_id`,
      [orgId, seasonYear],
    ),
    // What actually left the shelf: reason='used' movements on the ONE parts ledger.
    client.query<LedgerUsageRow>(
      `SELECT t.item_id AS "itemId", COALESCE(SUM(-t.delta), 0)::float8 AS "usedQuantity",
              count(*)::int AS "eventCount"
       FROM inventory_transactions t
       JOIN inventory_items i ON i.id = t.item_id AND i.org_id = t.org_id
       WHERE t.org_id = $1::uuid AND t.reason = 'used' AND t.delta < 0
         AND t.created_at >= ($2::timestamptz - make_interval(days => $3::int))
         AND i.category = 'spare'
       GROUP BY t.item_id`,
      [orgId, asOf.toISOString(), LEDGER_OBSERVATION_WINDOW_DAYS],
    ),
    loadHorizon(client, orgId, asOf),
  ]);

  const failureByName = new Map<string, number>();
  const failureById = new Map<string, number>();
  for (const row of fmeaResult.rows) {
    const count = Number(row.failureCount) || 0;
    const nameKey = row.subsystemName.trim().toLowerCase();
    failureByName.set(nameKey, (failureByName.get(nameKey) ?? 0) + count);
    if (row.subsystemId) failureById.set(row.subsystemId, (failureById.get(row.subsystemId) ?? 0) + count);
  }
  const ledgerByItem = new Map<string, { usedQuantity: number; eventCount: number }>();
  for (const row of ledgerResult.rows) {
    ledgerByItem.set(row.itemId, { usedQuantity: Number(row.usedQuantity) || 0, eventCount: Number(row.eventCount) || 0 });
  }

  const lines: SpareForecastLine[] = [];
  for (const row of inventoryResult.rows) {
    const subsystemKey = (row.subsystem ?? "").trim().toLowerCase();
    const failureCount =
      (row.subsystemId ? failureById.get(row.subsystemId) : undefined) ??
      (subsystemKey ? failureByName.get(subsystemKey) : undefined) ??
      0;
    const usage = ledgerByItem.get(row.id) ?? { usedQuantity: 0, eventCount: 0 };
    const observedPerDay = observedRate({
      usedQuantity: usage.usedQuantity,
      eventCount: usage.eventCount,
      windowDays: LEDGER_OBSERVATION_WINDOW_DAYS,
    });
    const fmeaPerDay = fmeaRate({ failureCount, daysElapsed });
    // Skip bins with neither ledger usage nor matched FMEA history — never fabricate a rate.
    if ((observedPerDay ?? 0) <= 0 && fmeaPerDay <= 0) continue;

    const quantityOnHand = Number(row.quantity) || 0;
    const unitCost = row.unitCost != null ? Number(row.unitCost) : null;
    const forecast: ExhaustionForecast = forecastExhaustion({
      quantityOnHand,
      observedPerDay: observedPerDay != null && observedPerDay > 0 ? observedPerDay : null,
      fmeaPerDay,
      horizonDays: horizon.horizonDays,
      horizonSource: horizon.horizonSource,
    });
    lines.push({
      itemId: row.id,
      itemName: row.name,
      category: row.category,
      subsystem: row.subsystem,
      quantityOnHand,
      failureCount,
      ledgerEventCount: usage.eventCount,
      observedPerDay,
      fmeaPerDay,
      unitCost,
      forecast,
    });
  }
  return {
    spareBinCount: inventoryResult.rows.length,
    forecastLines: sortForecastLines(lines),
    horizon,
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
      message: "Select a team workspace to forecast spare-parts exhaustion.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        {
          id: "inventory",
          label: "Stock spare parts",
          detail: "Add spare-category items in Inventory so they can be forecast — never DEMO bins",
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
    forecastLines: forecastBundle.forecastLines,
    horizon: forecastBundle.horizon,
    observationWindowDays: LEDGER_OBSERVATION_WINDOW_DAYS,
    purchaseRequests: purchaseRequestResult.rows.map(mapPurchaseRequest),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function draftPurchaseRequest(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; title: string; asOf?: Date },
): Promise<RenderOutcome> {
  const { forecastLines } = await loadForecastLines(client, input.orgId, input.seasonYear, input.asOf);

  const draftedLines = draftPurchaseRequestLines(forecastLines);
  const templateRationale = draftedLines.length
    ? `${draftedLines.length} spare(s) projected to exhaust before season end based on FMEA repeat-failure cadence.`
    : "No spares are currently projected to exhaust before season end.";

  // Real model call on the org's adapter with the deterministic draft as fallback: only the
  // per-line and overall rationale prose may be rewritten; quantities, costs, urgency and
  // the exhaustion math stay computed from FMEA cadence and bin counts.
  const {
    value: { lines: drafted, rationale },
    render,
  } = await renderFeatureValue({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "spare_forecast",
    value: { lines: draftedLines, rationale: templateRationale },
    editableKeys: ["rationale"],
    instructions: `Spare-parts purchase request "${input.title}" for the ${input.seasonYear} season. Rewrite each line's rationale as one plain sentence for the purchasing mentor and the overall rationale as 1-2 sentences, keeping every count, day figure and quantity exactly as given.`,
    metadata: { seasonYear: input.seasonYear, candidateCount: forecastLines.length },
  });

  const totalEstimatedCost = drafted.reduce((sum, line) => sum + line.estimatedCost, 0);

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
  return render;
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
