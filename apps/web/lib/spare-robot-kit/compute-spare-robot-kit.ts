import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { buildKitItems, CHECKLIST_STATUSES, checklistRationale, summarizeChecklistItems } from ".";
import type { ChecklistStatus, KitChecklistItem, SpareRobotKitChecklist } from "./types";

export { CHECKLIST_STATUSES };

export type SpareRobotKitSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SpareRobotKitView =
  | {
      status: "setup_required";
      message: string;
      steps: SpareRobotKitSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      candidateItems: KitChecklistItem[];
      checklists: SpareRobotKitChecklist[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isStatus(value: unknown): value is ChecklistStatus {
  return typeof value === "string" && (CHECKLIST_STATUSES as string[]).includes(value);
}

type InventoryRow = {
  id: string;
  name: string;
  category: string;
  subsystem: string | null;
  quantity: string;
  unitCost: string | null;
};

type FmeaAggregateRow = {
  subsystemName: string;
  failureCount: string;
  avgRpn: string;
};

type ChecklistRow = {
  id: string;
  seasonYear: number;
  title: string;
  status: string;
  items: KitChecklistItem[];
  rationale: string;
  createdAt: string;
  updatedAt: string;
};

function mapChecklist(row: ChecklistRow): SpareRobotKitChecklist {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    title: row.title,
    status: isStatus(row.status) ? row.status : "draft",
    items: Array.isArray(row.items) ? row.items : [],
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

async function loadCandidateItems(client: PoolClient, orgId: string, seasonYear: number): Promise<KitChecklistItem[]> {
  const [inventoryResult, fmeaResult] = await Promise.all([
    client.query<InventoryRow>(
      `SELECT id, name, category, subsystem, quantity::text AS quantity, unit_cost::text AS "unitCost"
       FROM inventory_items
       WHERE org_id = $1 AND archived = false AND is_spare
       ORDER BY name
       LIMIT 200`,
      [orgId],
    ),
    client.query<FmeaAggregateRow>(
      `SELECT subsystem_name AS "subsystemName", count(*)::text AS "failureCount",
              avg(occurrence * severity * detection)::text AS "avgRpn"
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2
       GROUP BY subsystem_name`,
      [orgId, seasonYear],
    ),
  ]);

  const bins = inventoryResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    subsystem: row.subsystem,
    quantityOnHand: Number(row.quantity) || 0,
    unitCost: row.unitCost != null ? Number(row.unitCost) : null,
  }));
  const aggregates = fmeaResult.rows.map((row) => ({
    subsystemName: row.subsystemName,
    failureCount: Number(row.failureCount) || 0,
    avgRpn: Number(row.avgRpn) || 0,
  }));

  return buildKitItems(bins, aggregates);
}

export async function computeSpareRobotKitView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SpareRobotKitView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to generate a spare-robot-kit checklist.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        {
          id: "inventory",
          label: "Stock spare parts",
          detail: "Add spare-category items in Inventory tagged with a subsystem",
          href: "/inventory",
        },
        {
          id: "fmea",
          label: "Log failures",
          detail: "Record subsystem failures so the checklist has repeat-failure history to draw from",
          href: "/build",
        },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [candidateItems, checklistResult, seasonResult] = await Promise.all([
    loadCandidateItems(client, org.orgId, seasonYear),
    client.query<ChecklistRow>(
      `SELECT id, season_year AS "seasonYear", title, status, items,
              rationale, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM spare_robot_kit_checklists
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM spare_robot_kit_checklists WHERE org_id = $1 ORDER BY season_year DESC`,
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
    candidateItems,
    checklists: checklistResult.rows.map(mapChecklist),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function generateChecklist(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; title: string },
): Promise<void> {
  const candidateItems = await loadCandidateItems(client, input.orgId, input.seasonYear);

  const generated = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "spare_robot_kit",
    requestId: `spare-robot-kit-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      seasonYear: input.seasonYear,
      candidateCount: candidateItems.length,
      note: "Deterministic failure-rate x inventory-bin kit checklist computation — no external model call",
    },
    invoke: async () => ({
      value: candidateItems,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-spare-robot-kit-v1",
      provider: "vantage-local",
    }),
  });

  const rationale = checklistRationale(generated);

  await client.query(
    `INSERT INTO spare_robot_kit_checklists (
       org_id, season_year, title, items, rationale, created_by
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
    [input.orgId, input.seasonYear, input.title, JSON.stringify(generated), rationale, input.userId],
  );
}

export async function togglePacked(
  client: PoolClient,
  input: { orgId: string; checklistId: string; itemId: string },
): Promise<void> {
  const existing = await client.query<ChecklistRow>(
    `SELECT id, season_year AS "seasonYear", title, status, items, rationale,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM spare_robot_kit_checklists WHERE id = $1 AND org_id = $2`,
    [input.checklistId, input.orgId],
  );
  const row = existing.rows[0];
  if (!row) return;
  const items = (Array.isArray(row.items) ? row.items : []).map((item) =>
    item.itemId === input.itemId ? { ...item, packed: !item.packed } : item,
  );
  await client.query(
    `UPDATE spare_robot_kit_checklists SET items = $1::jsonb, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [JSON.stringify(items), input.checklistId, input.orgId],
  );
}

export async function updateChecklistStatus(
  client: PoolClient,
  input: { orgId: string; checklistId: string; status: ChecklistStatus },
): Promise<void> {
  await client.query(
    `UPDATE spare_robot_kit_checklists SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.checklistId, input.orgId],
  );
}

export async function deleteChecklist(
  client: PoolClient,
  input: { orgId: string; checklistId: string },
): Promise<void> {
  await client.query(`DELETE FROM spare_robot_kit_checklists WHERE id = $1 AND org_id = $2`, [
    input.checklistId,
    input.orgId,
  ]);
}

export { summarizeChecklistItems };
