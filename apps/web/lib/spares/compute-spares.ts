import type { PoolClient } from "@neondatabase/serverless";
import { sortSpares, summarizeSpares } from ".";
import type { Consumable, ConsumableCategory, SparesSummary } from "./types";

export const CONSUMABLE_CATEGORIES: ConsumableCategory[] = [
  "fasteners",
  "electrical",
  "pneumatics",
  "adhesives",
  "stock",
  "tools",
  "ppe",
  "other",
];

export type SparesSetupStep = { id: string; label: string; detail: string; href: string };

export type SparesView =
  | {
      status: "setup_required";
      message: string;
      steps: SparesSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      items: Consumable[];
      summary: SparesSummary;
      computedAt: string;
    };

type ItemRow = {
  id: string;
  name: string;
  category: ConsumableCategory;
  unit: string;
  onHand: string | number | null;
  reorderPoint: string | number | null;
  preferredVendor: string | null;
  notes: string | null;
};

function num(value: string | number | null): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapItem(row: ItemRow): Consumable {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    onHand: num(row.onHand),
    reorderPoint: num(row.reorderPoint),
    preferredVendor: row.preferredVendor,
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

export async function computeSparesView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<SparesView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track consumables and spares.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const result = await client.query<ItemRow>(
    `SELECT id, name, category, unit, on_hand AS "onHand", reorder_point AS "reorderPoint",
            preferred_vendor AS "preferredVendor", notes
     FROM consumables WHERE org_id = $1`,
    [org.orgId],
  );

  const items = sortSpares(result.rows.map(mapItem));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    items,
    summary: summarizeSpares(items),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createConsumable(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: ConsumableCategory;
    unit: string;
    onHand: number;
    reorderPoint: number;
    preferredVendor: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO consumables (org_id, name, category, unit, on_hand, reorder_point, preferred_vendor, notes, created_by)
     VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8,$9)`,
    [
      input.orgId,
      input.name,
      input.category,
      input.unit || "each",
      Math.max(0, input.onHand),
      Math.max(0, input.reorderPoint),
      input.preferredVendor,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateConsumable(
  client: PoolClient,
  input: {
    orgId: string;
    itemId: string;
    name?: string;
    category?: ConsumableCategory;
    unit?: string;
    onHand?: number;
    reorderPoint?: number;
    preferredVendor?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE consumables SET
       name = COALESCE($3, name),
       category = COALESCE($4, category),
       unit = COALESCE($5, unit),
       on_hand = COALESCE($6::numeric, on_hand),
       reorder_point = COALESCE($7::numeric, reorder_point),
       preferred_vendor = CASE WHEN $8::boolean THEN $9 ELSE preferred_vendor END,
       notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.itemId,
      input.orgId,
      input.name ?? null,
      input.category ?? null,
      input.unit ?? null,
      input.onHand == null ? null : Math.max(0, input.onHand),
      input.reorderPoint == null ? null : Math.max(0, input.reorderPoint),
      input.preferredVendor !== undefined,
      input.preferredVendor ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function adjustStock(
  client: PoolClient,
  input: { orgId: string; itemId: string; delta: number },
): Promise<void> {
  await client.query(
    `UPDATE consumables SET on_hand = GREATEST(0, on_hand + $3::numeric), updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId, input.delta],
  );
}

export async function deleteConsumable(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM consumables WHERE id = $1 AND org_id = $2`, [input.itemId, input.orgId]);
}
