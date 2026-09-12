import type { PoolClient } from "@neondatabase/serverless";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { sortVendors, summarizeVendors } from ".";
import type { Vendor, VendorCategory, VendorsSummary } from "./types";

export const VENDOR_CATEGORIES: VendorCategory[] = [
  "electronics",
  "hardware",
  "raw_materials",
  "tools",
  "services",
  "apparel",
  "shipping",
  "other",
];

export type VendorsSetupStep = { id: string; label: string; detail: string; href: string };

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO vendor metrics. */
function setupStepsFor(orgId: string | null): VendorsSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Vendor directory.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "orders",
      label: "Open Orders",
      detail: "Purchase orders stay empty until drafted.",
      href: hubHref("/business", "orders", orgId),
    },
    {
      id: "vendor-lead-times",
      label: "Open Lead times",
      detail: "Reorder-by dates stay blank until lead times land.",
      href: hubHref("/business", "vendor-lead-times", orgId),
    },
  ];
}

export type VendorsView =
  | {
      status: "setup_required";
      message: string;
      steps: VendorsSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      vendors: Vendor[];
      summary: VendorsSummary;
      computedAt: string;
    };

type VendorRow = {
  id: string;
  name: string;
  category: VendorCategory;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  leadTimeDays: number | null;
  rating: number | null;
  preferred: boolean;
  accountNumber: string | null;
  notes: string | null;
};

function mapVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    website: row.website,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    leadTimeDays: row.leadTimeDays == null ? null : Number(row.leadTimeDays),
    rating: row.rating == null ? null : Number(row.rating),
    preferred: Boolean(row.preferred),
    accountNumber: row.accountNumber,
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

export async function computeVendorsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<VendorsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to keep a vendor directory.",
      steps: setupStepsFor(null),
      orgId: null,
    };
  }

  const result = await client.query<VendorRow>(
    `SELECT id, name, category, website, contact_name AS "contactName", contact_email AS "contactEmail",
            contact_phone AS "contactPhone", lead_time_days AS "leadTimeDays", rating, preferred,
            account_number AS "accountNumber", notes
     FROM vendors WHERE org_id = $1`,
    [org.orgId],
  );

  const vendors = sortVendors(result.rows.map(mapVendor));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    vendors,
    summary: summarizeVendors(vendors),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createVendor(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: VendorCategory;
    website: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    leadTimeDays: number | null;
    rating: number | null;
    preferred: boolean;
    accountNumber: string | null;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO vendors
       (org_id, name, category, website, contact_name, contact_email, contact_phone,
        lead_time_days, rating, preferred, account_number, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      input.orgId,
      input.name,
      input.category,
      input.website,
      input.contactName,
      input.contactEmail,
      input.contactPhone,
      input.leadTimeDays,
      input.rating,
      input.preferred,
      input.accountNumber,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateVendor(
  client: PoolClient,
  input: {
    orgId: string;
    vendorId: string;
    name?: string;
    category?: VendorCategory;
    website?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    leadTimeDays?: number | null;
    rating?: number | null;
    preferred?: boolean;
    accountNumber?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE vendors SET
       name = COALESCE($3, name),
       category = COALESCE($4, category),
       website = CASE WHEN $5::boolean THEN $6 ELSE website END,
       contact_name = CASE WHEN $7::boolean THEN $8 ELSE contact_name END,
       contact_email = CASE WHEN $9::boolean THEN $10 ELSE contact_email END,
       contact_phone = CASE WHEN $11::boolean THEN $12 ELSE contact_phone END,
       lead_time_days = CASE WHEN $13::boolean THEN $14 ELSE lead_time_days END,
       rating = CASE WHEN $15::boolean THEN $16 ELSE rating END,
       preferred = COALESCE($17, preferred),
       account_number = CASE WHEN $18::boolean THEN $19 ELSE account_number END,
       notes = CASE WHEN $20::boolean THEN $21 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.vendorId,
      input.orgId,
      input.name ?? null,
      input.category ?? null,
      input.website !== undefined,
      input.website ?? null,
      input.contactName !== undefined,
      input.contactName ?? null,
      input.contactEmail !== undefined,
      input.contactEmail ?? null,
      input.contactPhone !== undefined,
      input.contactPhone ?? null,
      input.leadTimeDays !== undefined,
      input.leadTimeDays ?? null,
      input.rating !== undefined,
      input.rating ?? null,
      input.preferred ?? null,
      input.accountNumber !== undefined,
      input.accountNumber ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteVendor(
  client: PoolClient,
  input: { orgId: string; vendorId: string },
): Promise<void> {
  await client.query(`DELETE FROM vendors WHERE id = $1 AND org_id = $2`, [input.vendorId, input.orgId]);
}
