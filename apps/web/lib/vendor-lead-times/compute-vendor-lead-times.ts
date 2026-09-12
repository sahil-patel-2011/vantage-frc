import type { PoolClient } from "@neondatabase/serverless";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { computeReorderByDate, sortReorderLines, summarizeReorders } from ".";
import type { ReorderLine, ReorderStatus, ReorderSummary, VendorLeadTime } from "./types";

export type VendorLeadTimesSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO reorder metrics. */
function setupStepsFor(orgId: string | null): VendorLeadTimesSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Vendor Lead Times.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "orders",
      label: "Open Orders",
      detail: "Purchase orders stay empty until drafted.",
      href: hubHref("/business", "orders", orgId),
    },
    {
      id: "spare-forecast",
      label: "Open Spares forecast",
      detail: "Spare shortfalls stay blank until inventory + Failure log land.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
    {
      id: "vendors",
      label: "Open Vendors",
      detail: "Supplier contacts stay empty until you add them.",
      href: withOrgHref("/vendors", orgId),
    },
  ];
}

export type VendorLeadTimesView =
  | {
      status: "setup_required";
      message: string;
      steps: VendorLeadTimesSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      vendors: VendorLeadTime[];
      reorders: ReorderLine[];
      summary: ReorderSummary;
      computedAt: string;
    };

type VendorRow = {
  id: string;
  name: string;
  leadTimeDays: number | string;
  safetyBufferDays: number | string;
  notes: string | null;
  createdAt: string;
};

type ReorderRow = {
  id: string;
  vendorId: string;
  vendorName: string;
  itemName: string;
  quantity: number | string;
  neededBy: string;
  status: ReorderStatus;
  notes: string | null;
  createdAt: string;
  leadTimeDays: number | string;
  safetyBufferDays: number | string;
};

function mapVendor(row: VendorRow): VendorLeadTime {
  return {
    id: row.id,
    name: row.name,
    leadTimeDays: Number(row.leadTimeDays) || 0,
    safetyBufferDays: Number(row.safetyBufferDays) || 0,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function mapReorder(row: ReorderRow, asOf: Date): ReorderLine {
  const calc = computeReorderByDate(
    {
      neededBy: row.neededBy,
      leadTimeDays: Number(row.leadTimeDays) || 0,
      safetyBufferDays: Number(row.safetyBufferDays) || 0,
      status: row.status,
    },
    asOf,
  );
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    itemName: row.itemName,
    quantity: Number(row.quantity) || 0,
    neededBy: row.neededBy,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    calc,
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

export async function computeVendorLeadTimesView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; asOf?: Date },
): Promise<VendorLeadTimesView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to track vendor lead times and reorders.",
      steps: setupStepsFor(null),
      orgId: null,
    };
  }

  const asOf = input.asOf ?? new Date();

  const [vendorResult, reorderResult] = await Promise.all([
    client.query<VendorRow>(
      `SELECT id, name, lead_time_days AS "leadTimeDays", safety_buffer_days AS "safetyBufferDays",
              notes, created_at::text AS "createdAt"
       FROM vendor_lead_times_vendors
       WHERE org_id = $1
       ORDER BY name`,
      [org.orgId],
    ),
    client.query<ReorderRow>(
      `SELECT r.id, r.vendor_id AS "vendorId", v.name AS "vendorName", r.item_name AS "itemName",
              r.quantity, r.needed_by::text AS "neededBy", r.status, r.notes,
              r.created_at::text AS "createdAt", v.lead_time_days AS "leadTimeDays",
              v.safety_buffer_days AS "safetyBufferDays"
       FROM vendor_lead_times_reorders r
       JOIN vendor_lead_times_vendors v ON v.id = r.vendor_id
       WHERE r.org_id = $1
       ORDER BY r.needed_by ASC, r.created_at DESC`,
      [org.orgId],
    ),
  ]);

  const vendors = vendorResult.rows.map(mapVendor);
  const reorders = sortReorderLines(reorderResult.rows.map((row) => mapReorder(row, asOf)));
  const summary = summarizeReorders(reorders);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    vendors,
    reorders,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addVendor(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    leadTimeDays: number;
    safetyBufferDays: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO vendor_lead_times_vendors (org_id, name, lead_time_days, safety_buffer_days, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.orgId,
      input.name,
      Math.max(0, Math.round(input.leadTimeDays)),
      Math.max(0, Math.round(input.safetyBufferDays)),
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteVendor(client: PoolClient, input: { orgId: string; vendorId: string }): Promise<void> {
  await client.query(`DELETE FROM vendor_lead_times_vendors WHERE id = $1 AND org_id = $2`, [
    input.vendorId,
    input.orgId,
  ]);
}

export async function addReorder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    vendorId: string;
    itemName: string;
    quantity: number;
    neededBy: string;
    notes: string | null;
  },
): Promise<void> {
  const vendorCheck = await client.query(`SELECT 1 FROM vendor_lead_times_vendors WHERE id = $1 AND org_id = $2`, [
    input.vendorId,
    input.orgId,
  ]);
  if (!vendorCheck.rowCount) throw new Error("vendorId is invalid for this organization");

  await client.query(
    `INSERT INTO vendor_lead_times_reorders (org_id, vendor_id, item_name, quantity, needed_by, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6)`,
    [input.orgId, input.vendorId, input.itemName, Math.max(1, Math.round(input.quantity)), input.neededBy, input.userId],
  );
}

export async function setReorderStatus(
  client: PoolClient,
  input: { orgId: string; reorderId: string; status: ReorderStatus },
): Promise<void> {
  await client.query(`UPDATE vendor_lead_times_reorders SET status = $1 WHERE id = $2 AND org_id = $3`, [
    input.status,
    input.reorderId,
    input.orgId,
  ]);
}

export async function deleteReorder(client: PoolClient, input: { orgId: string; reorderId: string }): Promise<void> {
  await client.query(`DELETE FROM vendor_lead_times_reorders WHERE id = $1 AND org_id = $2`, [
    input.reorderId,
    input.orgId,
  ]);
}
