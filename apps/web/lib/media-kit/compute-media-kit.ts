import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { buildOnePagerSections, computeMediaKitReadiness } from ".";
import type {
  MediaKitAsset,
  MediaKitAssetKind,
  MediaKitDocument,
  MediaKitProfile,
  MediaKitReadiness,
} from "./types";

export type MediaKitSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MediaKitView =
  | {
      status: "setup_required";
      message: string;
      steps: MediaKitSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      orgName: string;
      seasonYear: number;
      seasons: number[];
      profile: MediaKitProfile | null;
      assets: MediaKitAsset[];
      documents: MediaKitDocument[];
      readiness: MediaKitReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; orgName: string } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; orgName: string }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", o.name AS "orgName"
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

type ProfileRow = {
  seasonYear: number;
  missionStatement: string | null;
  teamBio: string | null;
  foundedYear: number | null;
  achievements: string[] | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  updatedAt: string;
};

function mapProfile(row: ProfileRow): MediaKitProfile {
  return {
    seasonYear: row.seasonYear,
    missionStatement: row.missionStatement,
    teamBio: row.teamBio,
    foundedYear: row.foundedYear,
    achievements: Array.isArray(row.achievements) ? row.achievements : [],
    contactEmail: row.contactEmail,
    websiteUrl: row.websiteUrl,
    updatedAt: row.updatedAt,
  };
}

type AssetRow = {
  id: string;
  kind: MediaKitAssetKind;
  title: string;
  url: string;
  description: string | null;
  createdAt: string;
};

function mapAsset(row: AssetRow): MediaKitAsset {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    description: row.description,
    createdAt: row.createdAt,
  };
}

type DocumentRow = {
  id: string;
  seasonYear: number;
  title: string;
  sections: MediaKitDocument["sections"];
  createdAt: string;
};

function mapDocument(row: DocumentRow): MediaKitDocument {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    title: row.title,
    sections: Array.isArray(row.sections) ? row.sections : [],
    createdAt: row.createdAt,
  };
}

export async function computeMediaKitView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MediaKitView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to build your media kit.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [profileResult, assetResult, documentResult, seasonResult] = await Promise.all([
    client.query<ProfileRow>(
      `SELECT season_year AS "seasonYear", mission_statement AS "missionStatement", team_bio AS "teamBio",
              founded_year AS "foundedYear", achievements, contact_email AS "contactEmail",
              website_url AS "websiteUrl", updated_at AS "updatedAt"
       FROM media_kit_profiles
       WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<AssetRow>(
      `SELECT id, kind, title, url, description, created_at AS "createdAt"
       FROM media_kit_assets
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [org.orgId],
    ),
    client.query<DocumentRow>(
      `SELECT id, season_year AS "seasonYear", title, sections, created_at AS "createdAt"
       FROM media_kit_documents
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM media_kit_profiles WHERE org_id = $1
       UNION SELECT DISTINCT season_year FROM media_kit_documents WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
  ]);

  const profile = profileResult.rows[0] ? mapProfile(profileResult.rows[0]) : null;
  const assets = assetResult.rows.map(mapAsset);
  const documents = documentResult.rows.map(mapDocument);
  const readiness = computeMediaKitReadiness(profile, assets);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    orgName: org.orgName,
    seasonYear,
    seasons,
    profile,
    assets,
    documents,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function upsertProfile(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    missionStatement: string | null;
    teamBio: string | null;
    foundedYear: number | null;
    achievements: string[];
    contactEmail: string | null;
    websiteUrl: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO media_kit_profiles (
       org_id, season_year, mission_statement, team_bio, founded_year, achievements,
       contact_email, website_url, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9)
     ON CONFLICT (org_id, season_year) DO UPDATE SET
       mission_statement = EXCLUDED.mission_statement,
       team_bio = EXCLUDED.team_bio,
       founded_year = EXCLUDED.founded_year,
       achievements = EXCLUDED.achievements,
       contact_email = EXCLUDED.contact_email,
       website_url = EXCLUDED.website_url,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.orgId,
      input.seasonYear,
      input.missionStatement,
      input.teamBio,
      input.foundedYear,
      input.achievements,
      input.contactEmail,
      input.websiteUrl,
      input.userId,
    ],
  );
}

export async function addAsset(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    kind: MediaKitAssetKind;
    title: string;
    url: string;
    description: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO media_kit_assets (org_id, kind, title, url, description, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.orgId, input.kind, input.title, input.url, input.description, input.userId],
  );
}

export async function deleteAsset(client: PoolClient, input: { orgId: string; assetId: string }): Promise<void> {
  await client.query(`DELETE FROM media_kit_assets WHERE id = $1 AND org_id = $2`, [input.assetId, input.orgId]);
}

export async function deleteDocument(
  client: PoolClient,
  input: { orgId: string; documentId: string },
): Promise<void> {
  await client.query(`DELETE FROM media_kit_documents WHERE id = $1 AND org_id = $2`, [
    input.documentId,
    input.orgId,
  ]);
}

/**
 * Generate a deterministic team one-pager grounded only in the recorded profile row,
 * asset library counts, and org identity. Wrapped in meteredAI so the run is billed and
 * audited through the standard usage-ledger path.
 */
export async function generateOnePager(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<MediaKitDocument> {
  const orgRow = await client.query<{ teamNumber: number | null; orgName: string }>(
    `SELECT team_number AS "teamNumber", name AS "orgName" FROM organizations WHERE id = $1`,
    [input.orgId],
  );
  const teamNumber = orgRow.rows[0]?.teamNumber ?? null;
  const orgName = orgRow.rows[0]?.orgName ?? "FRC Team";

  const profileResult = await client.query<ProfileRow>(
    `SELECT season_year AS "seasonYear", mission_statement AS "missionStatement", team_bio AS "teamBio",
            founded_year AS "foundedYear", achievements, contact_email AS "contactEmail",
            website_url AS "websiteUrl", updated_at AS "updatedAt"
     FROM media_kit_profiles WHERE org_id = $1 AND season_year = $2`,
    [input.orgId, input.seasonYear],
  );
  const profile = profileResult.rows[0] ? mapProfile(profileResult.rows[0]) : null;

  const assetCountResult = await client.query<{ total: string; logos: string }>(
    `SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE kind = 'logo')::text AS logos
     FROM media_kit_assets WHERE org_id = $1`,
    [input.orgId],
  );
  const assetCount = Number(assetCountResult.rows[0]?.total ?? 0) || 0;
  const logoCount = Number(assetCountResult.rows[0]?.logos ?? 0) || 0;

  const result = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "media_kit_one_pager",
    requestId: `media-kit-one-pager-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: { seasonYear: input.seasonYear, hasProfile: Boolean(profile) },
    invoke: async () => {
      const sections = buildOnePagerSections({
        teamNumber,
        orgName,
        seasonYear: input.seasonYear,
        profile,
        assetCount,
        logoCount,
      });
      return {
        value: sections,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-media-kit-v1",
        provider: "vantage-local",
      };
    },
  });

  const title = teamNumber != null ? `Team ${teamNumber} media kit — ${input.seasonYear}` : `${orgName} media kit — ${input.seasonYear}`;
  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO media_kit_documents (org_id, season_year, title, sections, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     RETURNING id, created_at AS "createdAt"`,
    [input.orgId, input.seasonYear, title, JSON.stringify(result), input.userId],
  );

  return {
    id: inserted.rows[0]!.id,
    seasonYear: input.seasonYear,
    title,
    sections: result,
    createdAt: inserted.rows[0]!.createdAt,
  };
}
