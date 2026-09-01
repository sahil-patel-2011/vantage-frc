import type { PoolClient } from "@neondatabase/serverless";
import { parseInventoryItemId } from "../orders/receive-to-inventory";
import { parseVendorId, resolveDirectoryVendor } from "../vendors/directory";

export const VENDOR_ID_REQUIRED = "Choose a vendor from the vendor directory.";
export const VENDOR_NOT_IN_DIRECTORY = "Vendor must be chosen from the vendor directory.";
export const INVENTORY_ITEM_ID_INVALID = "Inventory item must be a catalog UUID.";

export type PurchaseRequestCreateInput = {
  title: string;
  vendorId: string;
  itemUrl: string | null;
  quantity: number;
  unitCostUsd: number;
  justification: string | null;
  /** YYYY-MM-DD, or null when the buy sheet left "when" blank. */
  neededBy: string | null;
  /** Optional inventory catalog row restocked on receive. */
  inventoryItemId: string | null;
};

export type PurchaseRequestCreateValue = PurchaseRequestCreateInput & {
  totalCostUsd: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const NEEDED_BY_INVALID = "Needed by must be a date (YYYY-MM-DD).";

function parseNeededBy(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: NEEDED_BY_INVALID };
  const neededBy = value.trim();
  if (!neededBy) return { ok: true, value: null };
  if (!ISO_DATE.test(neededBy)) return { ok: false, error: NEEDED_BY_INVALID };
  return { ok: true, value: neededBy };
}

function parseItemUrl(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const itemUrl = typeof value === "string" ? value.trim() : "";
  if (!itemUrl) return { ok: true, value: null };
  try {
    const parsed = new URL(itemUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Item URL must be a valid URL" };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: "Item URL must be a valid URL" };
  }
}

function parseOptionalInventoryItemId(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: INVENTORY_ITEM_ID_INVALID };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = parseInventoryItemId(trimmed);
  if (!parsed) return { ok: false, error: INVENTORY_ITEM_ID_INVALID };
  return { ok: true, value: parsed };
}

/**
 * Create/edit validation for purchase requests.
 * Vendor identity is a directory UUID — free-text vendor names are ignored.
 */
export function validatePurchaseRequestCreate(
  input: Record<string, unknown>,
): { ok: true; value: PurchaseRequestCreateValue } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };

  const vendorId = parseVendorId(input.vendorId ?? input.vendor_id);
  if (!vendorId) return { ok: false, error: VENDOR_ID_REQUIRED };

  const quantityRaw = input.quantity === undefined || input.quantity === "" ? 1 : Number(input.quantity);
  if (!Number.isInteger(quantityRaw) || quantityRaw < 1) {
    return { ok: false, error: "Quantity must be a positive whole number" };
  }

  const unitCostUsd = Number(input.unitCostUsd ?? input.estimateUsd);
  if (!Number.isFinite(unitCostUsd) || unitCostUsd < 0) {
    return { ok: false, error: "Unit cost must be zero or greater" };
  }

  const itemUrl = parseItemUrl(input.itemUrl);
  if (!itemUrl.ok) return itemUrl;

  const justification = typeof input.justification === "string" ? input.justification.trim() : "";

  const neededBy = parseNeededBy(input.neededBy ?? input.needed_by);
  if (!neededBy.ok) return neededBy;

  const inventoryItemId = parseOptionalInventoryItemId(input.inventoryItemId ?? input.inventory_item_id);
  if (!inventoryItemId.ok) return inventoryItemId;

  return {
    ok: true,
    value: {
      title,
      vendorId,
      itemUrl: itemUrl.value,
      quantity: quantityRaw,
      unitCostUsd,
      justification: justification || null,
      neededBy: neededBy.value,
      inventoryItemId: inventoryItemId.value,
      totalCostUsd: round2(quantityRaw * unitCostUsd),
    },
  };
}

export async function insertDirectoryPurchaseRequest(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    categoryId?: string | null;
    body: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const validated = validatePurchaseRequestCreate(input.body);
  if (!validated.ok) throw new Error(validated.error);

  const vendor = await resolveDirectoryVendor(client, input.orgId, validated.value.vendorId);
  if (!vendor) throw new Error(VENDOR_NOT_IN_DIRECTORY);

  const result = await client.query(
    `INSERT INTO purchase_requests(
       org_id, season_year, category_id, requested_by, title, vendor, vendor_id,
       item_url, quantity, unit_cost_usd, total_cost_usd, justification, needed_by,
       inventory_item_id
     )
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, season_year AS "seasonYear", category_id AS "categoryId", requested_by AS "requestedBy",
       title, vendor, vendor_id AS "vendorId", item_url AS "itemUrl", quantity, unit_cost_usd AS "unitCostUsd",
       total_cost_usd AS "totalCostUsd", justification, needed_by::text AS "neededBy",
       inventory_item_id AS "inventoryItemId",
       status, created_at AS "createdAt"`,
    [
      input.orgId,
      input.seasonYear,
      input.categoryId ?? null,
      input.userId,
      validated.value.title,
      vendor.name,
      vendor.id,
      validated.value.itemUrl,
      validated.value.quantity,
      validated.value.unitCostUsd,
      validated.value.totalCostUsd,
      validated.value.justification,
      validated.value.neededBy,
      validated.value.inventoryItemId,
    ],
  );

  return { ...result.rows[0], vendorId: vendor.id, vendor: vendor.name };
}

export async function updateDirectoryPurchaseRequest(
  client: PoolClient,
  input: {
    orgId: string;
    id: string;
    categoryId?: string | null;
    body: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const validated = validatePurchaseRequestCreate(input.body);
  if (!validated.ok) throw new Error(validated.error);

  const vendor = await resolveDirectoryVendor(client, input.orgId, validated.value.vendorId);
  if (!vendor) throw new Error(VENDOR_NOT_IN_DIRECTORY);

  const result = await client.query(
    `UPDATE purchase_requests SET title=$1, vendor=$2, vendor_id=$3, item_url=$4, quantity=$5, unit_cost_usd=$6,
       total_cost_usd=$7, justification=$8, needed_by=$9, category_id=$10, inventory_item_id=$11, updated_at=now()
     WHERE id=$12 AND org_id=$13
     RETURNING id, status, vendor_id AS "vendorId", needed_by::text AS "neededBy",
       inventory_item_id AS "inventoryItemId"`,
    [
      validated.value.title,
      vendor.name,
      vendor.id,
      validated.value.itemUrl,
      validated.value.quantity,
      validated.value.unitCostUsd,
      validated.value.totalCostUsd,
      validated.value.justification,
      validated.value.neededBy,
      input.categoryId ?? null,
      validated.value.inventoryItemId,
      input.id,
      input.orgId,
    ],
  );

  return { ...result.rows[0], vendorId: vendor.id, vendor: vendor.name };
}
