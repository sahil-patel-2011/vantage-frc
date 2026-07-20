import type { PoolClient } from "@neondatabase/serverless";

export const PLATFORM_SPONSOR_TIERS = ["title", "ai", "partner", "prospect"] as const;
export type PlatformSponsorTier = (typeof PLATFORM_SPONSOR_TIERS)[number];

export const PLATFORM_SPONSOR_STATUSES = ["prospect", "active", "paused", "ended"] as const;
export type PlatformSponsorStatus = (typeof PLATFORM_SPONSOR_STATUSES)[number];

export const PLATFORM_SPONSOR_OUTREACH = [
  "not_started",
  "contacted",
  "in_discussion",
  "committed",
  "declined",
  "on_hold",
] as const;
export type PlatformSponsorOutreach = (typeof PLATFORM_SPONSOR_OUTREACH)[number];

export const PLATFORM_AI_COVERAGE = ["none", "partner_sponsored", "direct_keys_partner_brand"] as const;
export type PlatformAiCoverage = (typeof PLATFORM_AI_COVERAGE)[number];

export const PLATFORM_OUTREACH_STATUSES = [
  "prospect",
  "contacted",
  "demo",
  "negotiating",
  "won",
  "lost",
  "nurture",
] as const;
export type PlatformOutreachStatus = (typeof PLATFORM_OUTREACH_STATUSES)[number];

export type PlatformAppSponsor = {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  tier: PlatformSponsorTier;
  status: PlatformSponsorStatus;
  outreachStatus: PlatformSponsorOutreach;
  aiCoverage: PlatformAiCoverage;
  brandTagline: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PlatformOrgOutreach = {
  id: string;
  orgName: string;
  contactName: string | null;
  contactEmail: string | null;
  status: PlatformOutreachStatus;
  notes: string | null;
  nextActionAt: string | null;
  linkedOrgId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Public Soft-UI branding fields — never notes or outreach internals. */
export type ActiveSponsorBrand = {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  tier: PlatformSponsorTier;
  aiCoverage: PlatformAiCoverage;
  brandTagline: string | null;
};

function asHttpsUrl(value: string | null | undefined, field: string): string | null {
  if (value == null || !value.trim()) return null;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error(`${field} must be an https:// URL`);
  }
  return trimmed;
}

function trimOrNull(value: string | null | undefined, max: number, field: string): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error(`${field} is too long`);
  return trimmed;
}

export async function listPlatformAppSponsors(client: PoolClient): Promise<PlatformAppSponsor[]> {
  const result = await client.query<{
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    tier: PlatformSponsorTier;
    status: PlatformSponsorStatus;
    outreachStatus: PlatformSponsorOutreach;
    aiCoverage: PlatformAiCoverage;
    brandTagline: string | null;
    notes: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name,
            logo_url AS "logoUrl", website_url AS "websiteUrl",
            tier, status,
            outreach_status AS "outreachStatus",
            ai_coverage AS "aiCoverage",
            brand_tagline AS "brandTagline", notes,
            sort_order AS "sortOrder",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM platform_app_sponsors
     ORDER BY sort_order ASC, name ASC`,
  );
  return result.rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function listActiveSponsorBrands(client: PoolClient): Promise<ActiveSponsorBrand[]> {
  const result = await client.query<ActiveSponsorBrand>(
    `SELECT id, name,
            logo_url AS "logoUrl", website_url AS "websiteUrl",
            tier, ai_coverage AS "aiCoverage",
            brand_tagline AS "brandTagline"
     FROM platform_app_sponsors
     WHERE status = 'active'
     ORDER BY sort_order ASC, name ASC
     LIMIT 12`,
  );
  return result.rows;
}

export async function upsertPlatformAppSponsor(
  client: PoolClient,
  actorUserId: string,
  input: {
    id?: string;
    name: string;
    logoUrl?: string | null;
    websiteUrl?: string | null;
    tier: PlatformSponsorTier;
    status: PlatformSponsorStatus;
    outreachStatus: PlatformSponsorOutreach;
    aiCoverage: PlatformAiCoverage;
    brandTagline?: string | null;
    notes?: string | null;
    sortOrder?: number;
  },
): Promise<PlatformAppSponsor> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 160) throw new Error("Sponsor name is required");
  if (!(PLATFORM_SPONSOR_TIERS as readonly string[]).includes(input.tier)) {
    throw new Error("Invalid sponsor tier");
  }
  if (!(PLATFORM_SPONSOR_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error("Invalid sponsor status");
  }
  if (!(PLATFORM_SPONSOR_OUTREACH as readonly string[]).includes(input.outreachStatus)) {
    throw new Error("Invalid outreach status");
  }
  if (!(PLATFORM_AI_COVERAGE as readonly string[]).includes(input.aiCoverage)) {
    throw new Error("Invalid AI coverage framing");
  }

  const logoUrl = asHttpsUrl(input.logoUrl, "logoUrl");
  const websiteUrl = asHttpsUrl(input.websiteUrl, "websiteUrl");
  const brandTagline = trimOrNull(input.brandTagline, 120, "brandTagline");
  const notes = trimOrNull(input.notes, 8000, "notes");
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.floor(input.sortOrder!) : 0;

  if (input.id) {
    const updated = await client.query<{
      id: string;
      name: string;
      logoUrl: string | null;
      websiteUrl: string | null;
      tier: PlatformSponsorTier;
      status: PlatformSponsorStatus;
      outreachStatus: PlatformSponsorOutreach;
      aiCoverage: PlatformAiCoverage;
      brandTagline: string | null;
      notes: string | null;
      sortOrder: number;
      createdAt: Date;
      updatedAt: Date;
    }>(
      `UPDATE platform_app_sponsors SET
         name = $2, logo_url = $3, website_url = $4, tier = $5, status = $6,
         outreach_status = $7, ai_coverage = $8, brand_tagline = $9, notes = $10,
         sort_order = $11, updated_at = now(), updated_by = $12
       WHERE id = $1::uuid
       RETURNING id, name,
         logo_url AS "logoUrl", website_url AS "websiteUrl",
         tier, status, outreach_status AS "outreachStatus",
         ai_coverage AS "aiCoverage", brand_tagline AS "brandTagline", notes,
         sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        input.id,
        name,
        logoUrl,
        websiteUrl,
        input.tier,
        input.status,
        input.outreachStatus,
        input.aiCoverage,
        brandTagline,
        notes,
        sortOrder,
        actorUserId,
      ],
    );
    if (!updated.rows[0]) throw new Error("Sponsor not found");
    const row = updated.rows[0];
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  const created = await client.query<{
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    tier: PlatformSponsorTier;
    status: PlatformSponsorStatus;
    outreachStatus: PlatformSponsorOutreach;
    aiCoverage: PlatformAiCoverage;
    brandTagline: string | null;
    notes: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `INSERT INTO platform_app_sponsors(
       name, logo_url, website_url, tier, status, outreach_status, ai_coverage,
       brand_tagline, notes, sort_order, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, name,
       logo_url AS "logoUrl", website_url AS "websiteUrl",
       tier, status, outreach_status AS "outreachStatus",
       ai_coverage AS "aiCoverage", brand_tagline AS "brandTagline", notes,
       sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      name,
      logoUrl,
      websiteUrl,
      input.tier,
      input.status,
      input.outreachStatus,
      input.aiCoverage,
      brandTagline,
      notes,
      sortOrder,
      actorUserId,
    ],
  );
  const row = created.rows[0]!;
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function deletePlatformAppSponsor(client: PoolClient, id: string): Promise<void> {
  const result = await client.query(`DELETE FROM platform_app_sponsors WHERE id = $1::uuid`, [id]);
  if (!result.rowCount) throw new Error("Sponsor not found");
}

export async function listPlatformOrgOutreach(client: PoolClient): Promise<PlatformOrgOutreach[]> {
  const result = await client.query<{
    id: string;
    orgName: string;
    contactName: string | null;
    contactEmail: string | null;
    status: PlatformOutreachStatus;
    notes: string | null;
    nextActionAt: string | null;
    linkedOrgId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, org_name AS "orgName",
            contact_name AS "contactName", contact_email AS "contactEmail",
            status, notes,
            next_action_at::text AS "nextActionAt",
            linked_org_id AS "linkedOrgId",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM platform_org_outreach
     ORDER BY
       CASE status
         WHEN 'negotiating' THEN 0 WHEN 'demo' THEN 1 WHEN 'contacted' THEN 2
         WHEN 'prospect' THEN 3 WHEN 'nurture' THEN 4 ELSE 5
       END,
       next_action_at ASC NULLS LAST,
       updated_at DESC`,
  );
  return result.rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertPlatformOrgOutreach(
  client: PoolClient,
  actorUserId: string,
  input: {
    id?: string;
    orgName: string;
    contactName?: string | null;
    contactEmail?: string | null;
    status: PlatformOutreachStatus;
    notes?: string | null;
    nextActionAt?: string | null;
    linkedOrgId?: string | null;
  },
): Promise<PlatformOrgOutreach> {
  const orgName = input.orgName.trim();
  if (orgName.length < 1 || orgName.length > 160) throw new Error("Organization name is required");
  if (!(PLATFORM_OUTREACH_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error("Invalid outreach status");
  }
  const contactName = trimOrNull(input.contactName, 160, "contactName");
  const contactEmail = trimOrNull(input.contactEmail, 320, "contactEmail");
  const notes = trimOrNull(input.notes, 8000, "notes");
  const nextActionAt =
    input.nextActionAt && /^\d{4}-\d{2}-\d{2}$/.test(input.nextActionAt.trim())
      ? input.nextActionAt.trim()
      : null;
  const linkedOrgId = input.linkedOrgId?.trim() || null;

  if (input.id) {
    const updated = await client.query<{
      id: string;
      orgName: string;
      contactName: string | null;
      contactEmail: string | null;
      status: PlatformOutreachStatus;
      notes: string | null;
      nextActionAt: string | null;
      linkedOrgId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>(
      `UPDATE platform_org_outreach SET
         org_name = $2, contact_name = $3, contact_email = $4, status = $5,
         notes = $6, next_action_at = $7::date, linked_org_id = $8::uuid,
         updated_at = now(), updated_by = $9
       WHERE id = $1::uuid
       RETURNING id, org_name AS "orgName",
         contact_name AS "contactName", contact_email AS "contactEmail",
         status, notes, next_action_at::text AS "nextActionAt",
         linked_org_id AS "linkedOrgId",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        input.id,
        orgName,
        contactName,
        contactEmail,
        input.status,
        notes,
        nextActionAt,
        linkedOrgId,
        actorUserId,
      ],
    );
    if (!updated.rows[0]) throw new Error("Outreach row not found");
    const row = updated.rows[0];
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  const created = await client.query<{
    id: string;
    orgName: string;
    contactName: string | null;
    contactEmail: string | null;
    status: PlatformOutreachStatus;
    notes: string | null;
    nextActionAt: string | null;
    linkedOrgId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `INSERT INTO platform_org_outreach(
       org_name, contact_name, contact_email, status, notes, next_action_at, linked_org_id, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6::date,$7::uuid,$8)
     RETURNING id, org_name AS "orgName",
       contact_name AS "contactName", contact_email AS "contactEmail",
       status, notes, next_action_at::text AS "nextActionAt",
       linked_org_id AS "linkedOrgId",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [orgName, contactName, contactEmail, input.status, notes, nextActionAt, linkedOrgId, actorUserId],
  );
  const row = created.rows[0]!;
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function deletePlatformOrgOutreach(client: PoolClient, id: string): Promise<void> {
  const result = await client.query(`DELETE FROM platform_org_outreach WHERE id = $1::uuid`, [id]);
  if (!result.rowCount) throw new Error("Outreach row not found");
}

export function aiCoverageLabel(coverage: PlatformAiCoverage): string {
  if (coverage === "partner_sponsored") return "Partner-sponsored AI";
  if (coverage === "direct_keys_partner_brand") return "Direct keys · partner brand";
  return "No AI framing";
}
