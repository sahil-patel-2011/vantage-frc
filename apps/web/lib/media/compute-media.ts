import type { PoolClient } from "@neondatabase/serverless";
import { computeMediaKitReadiness } from "../media-kit";
import type { MediaKitAsset, MediaKitProfile } from "../media-kit/types";
import {
  listMediaContentItems,
  processDueMediaReminders,
} from "./compute-media-content";
import type {
  MediaAssetPreview,
  MediaContentItem,
  MediaImpactPreview,
  MediaImpactSummary,
  MediaKitSummary,
  MediaOutreachPreview,
  MediaOutreachSummary,
  MediaSponsorWallSummary,
} from "./types";

export type MediaSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MediaView =
  | {
      status: "setup_required";
      message: string;
      steps: MediaSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      orgName: string;
      seasonYear: number;
      kit: MediaKitSummary;
      outreach: MediaOutreachSummary;
      impact: MediaImpactSummary;
      sponsorWall: MediaSponsorWallSummary;
      items: MediaContentItem[];
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
  missionStatement: string | null;
  teamBio: string | null;
  foundedYear: number | null;
  achievements: string[] | null;
  contactEmail: string | null;
  websiteUrl: string | null;
};

type AssetRow = {
  id: string;
  kind: string;
  title: string;
  url: string;
  description: string | null;
  createdAt: string;
};

type AssetCountRow = {
  assetCount: string | number;
  logoCount: string | number;
  photoCount: string | number;
};

type DocumentCountRow = { documentCount: string | number };

type OutreachRow = {
  id: string;
  title: string;
  category: string;
  scheduledOn: string;
  status: string;
};

type OutreachCountRow = {
  upcomingCount: string | number;
  mediaCategoryCount: string | number;
};

type ImpactRow = {
  id: string;
  title: string;
  category: string;
  occurredOn: string;
  peopleReached: string | number;
};

type ImpactCountRow = {
  mediaActivityCount: string | number;
  peopleReached: string | number;
};

type SponsorWallRow = {
  publishedEntryCount: string | number;
  wallPublished: boolean | null;
};

function mapProfile(row: ProfileRow): MediaKitProfile {
  return {
    seasonYear: 0,
    missionStatement: row.missionStatement,
    teamBio: row.teamBio,
    foundedYear: row.foundedYear,
    achievements: Array.isArray(row.achievements) ? row.achievements : [],
    contactEmail: row.contactEmail,
    websiteUrl: row.websiteUrl,
    updatedAt: "",
  };
}

function mapAsset(row: AssetRow): MediaKitAsset {
  return {
    id: row.id,
    kind: (["logo", "photo", "graphic", "other"].includes(row.kind)
      ? row.kind
      : "other") as MediaKitAsset["kind"],
    title: row.title,
    url: row.url,
    description: row.description,
    createdAt: row.createdAt,
  };
}

function toInt(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Soft-UI Media team view — fans in real Media Kit, outreach, impact, and
 * sponsor-wall counts. Never invents DEMO metrics; empty boards stay empty.
 */
export async function computeMediaView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MediaView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to open the Media team.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick which FRC team you are working as.",
          href: "/workspace",
        },
      ],
      orgId: null,
      seasonYear,
    };
  }

  // Fire due media reminders before listing so the Soft-UI board stays current.
  await processDueMediaReminders(client, {
    orgId: org.orgId,
    userId: input.userId,
    seasonYear,
  });

  const [
    profileResult,
    assetCountResult,
    assetResult,
    documentResult,
    outreachCountResult,
    outreachListResult,
    impactCountResult,
    impactListResult,
    sponsorWallResult,
    items,
  ] = await Promise.all([
    client.query<ProfileRow>(
      `SELECT mission_statement AS "missionStatement", team_bio AS "teamBio",
              founded_year AS "foundedYear", achievements, contact_email AS "contactEmail",
              website_url AS "websiteUrl"
       FROM media_kit_profiles
       WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<AssetCountRow>(
      `SELECT
         COUNT(*)::int AS "assetCount",
         COUNT(*) FILTER (WHERE kind = 'logo')::int AS "logoCount",
         COUNT(*) FILTER (WHERE kind = 'photo')::int AS "photoCount"
       FROM media_kit_assets
       WHERE org_id = $1`,
      [org.orgId],
    ),
    client.query<AssetRow>(
      `SELECT id, kind, title, url, description, created_at AS "createdAt"
       FROM media_kit_assets
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [org.orgId],
    ),
    client.query<DocumentCountRow>(
      `SELECT COUNT(*)::int AS "documentCount"
       FROM media_kit_documents
       WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<OutreachCountRow>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status IN ('planned','confirmed')
             AND scheduled_on >= CURRENT_DATE
         )::int AS "upcomingCount",
         COUNT(*) FILTER (WHERE category = 'media')::int AS "mediaCategoryCount"
       FROM outreach_calendar_events
       WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<OutreachRow>(
      `SELECT id, title, category, scheduled_on::text AS "scheduledOn", status
       FROM outreach_calendar_events
       WHERE org_id = $1
         AND season_year = $2
         AND status IN ('planned','confirmed')
         AND scheduled_on >= CURRENT_DATE
       ORDER BY scheduled_on ASC
       LIMIT 5`,
      [org.orgId, seasonYear],
    ),
    client.query<ImpactCountRow>(
      `SELECT
         COUNT(*)::int AS "mediaActivityCount",
         COALESCE(SUM(people_reached), 0)::int AS "peopleReached"
       FROM impact_activities
       WHERE org_id = $1 AND season_year = $2 AND category = 'media'`,
      [org.orgId, seasonYear],
    ),
    client.query<ImpactRow>(
      `SELECT id, title, category, occurred_on::text AS "occurredOn",
              people_reached AS "peopleReached"
       FROM impact_activities
       WHERE org_id = $1 AND season_year = $2 AND category = 'media'
       ORDER BY occurred_on DESC
       LIMIT 5`,
      [org.orgId, seasonYear],
    ),
    client.query<SponsorWallRow>(
      `SELECT
         (SELECT COUNT(*)::int FROM sponsor_wall_entries
          WHERE org_id = $1 AND published = true) AS "publishedEntryCount",
         (SELECT published FROM sponsor_wall_settings WHERE org_id = $1) AS "wallPublished"`,
      [org.orgId],
    ),
    listMediaContentItems(client, { orgId: org.orgId, seasonYear }),
  ]);

  const profile = profileResult.rows[0] ? mapProfile(profileResult.rows[0]) : null;
  const assetCounts = assetCountResult.rows[0];
  const logoCount = toInt(assetCounts?.logoCount);
  const readinessAssets: MediaKitAsset[] =
    logoCount > 0
      ? [
          {
            id: "logo-signal",
            kind: "logo",
            title: "logo",
            url: "https://example.invalid/logo",
            description: null,
            createdAt: "",
          },
        ]
      : [];
  const readiness = computeMediaKitReadiness(profile, readinessAssets);
  const recentAssets: MediaAssetPreview[] = assetResult.rows.map((row) => {
    const asset = mapAsset(row);
    return {
      id: asset.id,
      kind: asset.kind,
      title: asset.title,
      url: asset.url,
      createdAt: asset.createdAt,
    };
  });

  const outreachCounts = outreachCountResult.rows[0];
  const upcoming: MediaOutreachPreview[] = outreachListResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    scheduledOn: row.scheduledOn,
    status: row.status,
  }));

  const impactCounts = impactCountResult.rows[0];
  const recentImpact: MediaImpactPreview[] = impactListResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    occurredOn: row.occurredOn,
    peopleReached: toInt(row.peopleReached),
  }));

  const wall = sponsorWallResult.rows[0];

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    orgName: org.orgName,
    seasonYear,
    kit: {
      readinessScore: readiness.score,
      readinessTier: readiness.tier,
      missingFields: readiness.missingFields,
      assetCount: toInt(assetCounts?.assetCount),
      logoCount,
      photoCount: toInt(assetCounts?.photoCount),
      documentCount: toInt(documentResult.rows[0]?.documentCount),
      recentAssets,
    },
    outreach: {
      upcomingCount: toInt(outreachCounts?.upcomingCount),
      mediaCategoryCount: toInt(outreachCounts?.mediaCategoryCount),
      upcoming,
    },
    impact: {
      mediaActivityCount: toInt(impactCounts?.mediaActivityCount),
      peopleReached: toInt(impactCounts?.peopleReached),
      recent: recentImpact,
    },
    sponsorWall: {
      publishedEntryCount: toInt(wall?.publishedEntryCount),
      wallPublished: Boolean(wall?.wallPublished),
    },
    items,
    computedAt: new Date().toISOString(),
  };
}
