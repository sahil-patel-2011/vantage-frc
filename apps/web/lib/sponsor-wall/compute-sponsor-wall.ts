import type { PoolClient } from "@neondatabase/serverless";
import { sortWallEntries, summarizeWall } from ".";
import type { SponsorWallEntry, SponsorWallSettings, SponsorWallSummary, SponsorWallTheme, SponsorWallTier } from "./types";

export type SponsorWallSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SponsorWallView =
  | {
      status: "setup_required";
      message: string;
      steps: SponsorWallSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      settings: SponsorWallSettings;
      /** Token for the public read-only page at /sponsor-wall/{publicId}; null until settings are saved. */
      publicId: string | null;
      entries: SponsorWallEntry[];
      summary: SponsorWallSummary;
      computedAt: string;
    };

type EntryRow = {
  id: string;
  sponsorName: string;
  tier: SponsorWallTier;
  mediaAssetId: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  message: string | null;
  displayOrder: number;
  published: boolean;
  createdAt: string;
};

type SettingsRow = {
  headline: string;
  subtitle: string | null;
  theme: SponsorWallTheme;
  published: boolean;
  publicId: string;
};

const DEFAULT_SETTINGS: SponsorWallSettings = {
  headline: "Thank You to Our Sponsors",
  subtitle: null,
  theme: "light",
  published: false,
};

function mapEntry(row: EntryRow): SponsorWallEntry {
  return {
    id: row.id,
    sponsorName: row.sponsorName,
    tier: row.tier,
    mediaAssetId: row.mediaAssetId,
    logoUrl: row.logoUrl,
    websiteUrl: row.websiteUrl,
    message: row.message,
    displayOrder: Number(row.displayOrder) || 0,
    published: row.published,
    createdAt: row.createdAt,
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

export async function computeSponsorWallView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<SponsorWallView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to build your sponsor thank-you wall.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [entriesResult, settingsResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT w.id, w.sponsor_name AS "sponsorName", w.tier,
              a.id AS "mediaAssetId", w.logo_url AS "logoUrl", w.website_url AS "websiteUrl",
              w.message, w.display_order AS "displayOrder", w.published, w.created_at::text AS "createdAt"
       FROM sponsor_wall_entries w
       LEFT JOIN media_kit_assets a ON a.org_id = w.org_id AND a.url = w.logo_url
       WHERE w.org_id = $1
       ORDER BY w.display_order ASC, w.created_at DESC`,
      [org.orgId],
    ),
    client.query<SettingsRow>(
      `SELECT headline, subtitle, theme, published, public_id AS "publicId"
       FROM sponsor_wall_settings WHERE org_id = $1`,
      [org.orgId],
    ),
  ]);

  const entries = sortWallEntries(entriesResult.rows.map(mapEntry));
  const summary = summarizeWall(entries);
  const settingsRow = settingsResult.rows[0] ?? null;
  const settings: SponsorWallSettings = settingsRow
    ? {
        headline: settingsRow.headline,
        subtitle: settingsRow.subtitle,
        theme: settingsRow.theme,
        published: settingsRow.published,
      }
    : DEFAULT_SETTINGS;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    settings,
    publicId: settingsRow?.publicId ?? null,
    entries,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sponsorName: string;
    tier: SponsorWallTier;
    logoUrl: string | null;
    websiteUrl: string | null;
    message: string | null;
    displayOrder: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sponsor_wall_entries (
       org_id, sponsor_name, tier, logo_url, website_url, message, display_order, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.sponsorName,
      input.tier,
      input.logoUrl,
      input.websiteUrl,
      input.message,
      Math.max(0, Math.round(input.displayOrder)),
      input.userId,
    ],
  );
}

export async function updateEntryPublished(
  client: PoolClient,
  input: { orgId: string; entryId: string; published: boolean },
): Promise<void> {
  await client.query(
    `UPDATE sponsor_wall_entries SET published = $3 WHERE id = $1 AND org_id = $2`,
    [input.entryId, input.orgId, input.published],
  );
}

export async function deleteEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM sponsor_wall_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}

export async function upsertSettings(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    headline: string;
    subtitle: string | null;
    theme: SponsorWallTheme;
    published: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sponsor_wall_settings (org_id, headline, subtitle, theme, published, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id) DO UPDATE SET
       headline = EXCLUDED.headline,
       subtitle = EXCLUDED.subtitle,
       theme = EXCLUDED.theme,
       published = EXCLUDED.published,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [input.orgId, input.headline, input.subtitle, input.theme, input.published, input.userId],
  );
}
