import type { PoolClient } from "@neondatabase/serverless";
import { deriveFoulRisk, deriveReliability } from "@vantage/intel-research";
import {
  buildTeamDossierFacts,
  dossierHasReferenceFacts,
  type DossierFactCard,
  type EventMetricRow,
  type TeamOperationalSignal,
  type YearMetricRow,
} from "@vantage/prediction-strategy";
import { resolveReferenceAccess } from "../strategy/compute-strategy";
import type { DataSourceHealthView } from "../reference-health";
import type { ReferenceAccessInfo } from "../strategy/types";
import { dossierSetupSteps } from "./dossier-related";
import { withOrgHref } from "../nav/product-nav";
import { scoutMediaUrl } from "../scout-media/client";

export type DossierSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
  done?: boolean;
};

export type DossierView =
  | {
      status: "setup_required" | "empty";
      message: string;
      steps: DossierSetupStep[];
      orgId: string | null;
      teamNumber: number | null;
      referenceAccess: ReferenceAccessInfo;
      dataSourceHealth?: DataSourceHealthView;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number;
      teamKey: string;
      nickname: string | null;
      name: string | null;
      cards: DossierFactCard[];
      hasReferenceFacts: boolean;
      referenceAccess: ReferenceAccessInfo;
      dataSourceHealth?: DataSourceHealthView;
      /** Up to four newest org pit photos of this team (metadata + URLs, never bytes). */
      pitPhotos: DossierPitPhoto[];
      computedAt: string;
    };

export type DossierPitPhoto = {
  clientId: string;
  eventKey: string;
  capturedAt: string;
  thumbUrl: string;
  url: string;
};

const DOSSIER_PIT_PHOTO_LIMIT = 4;

/** Newest pit photos the org holds for this team — real rows only, empty when none. */
async function loadDossierPitPhotos(
  client: PoolClient,
  orgId: string,
  teamKey: string,
): Promise<DossierPitPhoto[]> {
  const rows = await client.query<{
    clientId: string;
    eventKey: string;
    capturedAt: string;
    hasThumb: boolean;
  }>(
    `SELECT client_id AS "clientId", event_key AS "eventKey",
            created_at::text AS "capturedAt", (thumb_bytes IS NOT NULL) AS "hasThumb"
     FROM scout_media
     WHERE org_id = $1::uuid
       AND team_key = $2
       AND kind = 'photo'
       AND status = 'uploaded'
       AND deleted_at IS NULL
       AND bytes IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $3::int`,
    [orgId, teamKey, DOSSIER_PIT_PHOTO_LIMIT],
  );
  return rows.rows.map((row) => ({
    clientId: row.clientId,
    eventKey: row.eventKey,
    capturedAt: row.capturedAt,
    thumbUrl: scoutMediaUrl(orgId, row.clientId, row.hasThumb ? "thumb" : "full"),
    url: scoutMediaUrl(orgId, row.clientId),
  }));
}

async function loadSeasonScoutOps(
  client: PoolClient,
  orgId: string,
  teamKey: string,
): Promise<TeamOperationalSignal[]> {
  const rows = await client.query<{
    payload: Record<string, unknown>;
    confidence: string | null;
  }>(
    `SELECT payload, confidence FROM match_scout_entries
     WHERE org_id = $1 AND team_key = $2
     UNION ALL
     SELECT payload, confidence FROM pit_scout_entries
     WHERE org_id = $1 AND team_key = $2
     LIMIT 200`,
    [orgId, teamKey],
  );
  if (!rows.rows.length) return [];
  const observations = rows.rows.map((row) => ({
    payload: row.payload ?? {},
    confidence:
      row.confidence === "high" || row.confidence === "low"
        ? (row.confidence as "high" | "low")
        : ("normal" as const),
  }));
  const reliability = deriveReliability(observations);
  const foulRisk = deriveFoulRisk(observations);
  return [
    {
      teamKey,
      scoutSample: observations.length,
      reliability: reliability.score ?? undefined,
      foulRate: foulRisk.rate ?? undefined,
    },
  ];
}

export async function computeTeamDossier(
  client: PoolClient,
  input: {
    userId: string;
    requestedOrg: string | null;
    teamNumber?: number | null;
  },
): Promise<DossierView> {
  const membership = await client.query<{
    orgId: string;
    teamNumber: number | null;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );

  const row = membership.rows[0];
  const access = await resolveReferenceAccess(client, row?.orgId ?? null);
  const orgId = row?.orgId ?? null;
  const teamNumber = input.teamNumber ?? row?.teamNumber ?? null;

  /** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO stats. */
  const baseSteps = dossierSetupSteps(orgId);
  const steps: DossierSetupStep[] = [
    {
      ...baseSteps.find((s) => s.id === "workspace")!,
      done: Boolean(orgId),
    },
    {
      id: "tba",
      label: "Sync TBA identity + schedule",
      detail: access.tbaConfigured
        ? "TBA credential or cache available"
        : "Set TBA_AUTH_KEY or save a TBA credential, then sync — never invent DEMO identity.",
      href: withOrgHref("/team/data", orgId),
      done: access.tbaConfigured,
    },
    {
      id: "statbotics",
      label: "Cache Statbotics season EPA",
      detail: access.statbotics.cacheHasMetrics
        ? `Neon has ${access.statbotics.yearMetricRows} year + ${access.statbotics.eventMetricRows} event Statbotics rows`
        : "No Statbotics EPA cached yet — run reference sync (public API). Never invent DEMO EPA.",
      href: withOrgHref("/team/data", orgId),
      done: access.statbotics.cacheHasMetrics,
    },
    {
      ...baseSteps.find((s) => s.id === "strategy")!,
      done: false,
    },
    {
      ...baseSteps.find((s) => s.id === "scouting")!,
      done: false,
    },
    {
      ...baseSteps.find((s) => s.id === "pick-desk")!,
      done: false,
    },
  ];

  if (!row?.orgId) {
    return {
      status: "setup_required",
      message: "Select a team workspace before opening a season dossier.",
      steps,
      orgId: null,
      teamNumber,
      referenceAccess: access,
    };
  }

  if (!teamNumber) {
    return {
      status: "setup_required",
      message: "Provide a team number (or set your org team number) to load a dossier.",
      steps,
      orgId: row.orgId,
      teamNumber: null,
      referenceAccess: access,
    };
  }

  const teamKey = `frc${teamNumber}`;
  const identity = await client.query<{
    teamKey: string;
    teamNumber: number;
    nickname: string | null;
    name: string | null;
    city: string | null;
    stateProv: string | null;
    country: string | null;
    rookieYear: number | null;
    syncedAt: string | null;
  }>(
    `SELECT team_key AS "teamKey", team_number AS "teamNumber", nickname, name,
            city, state_prov AS "stateProv", country, rookie_year AS "rookieYear",
            synced_at::text AS "syncedAt"
     FROM teams_ref
     WHERE team_key = $1 OR team_number = $2
     LIMIT 1`,
    [teamKey, teamNumber],
  );

  const team = identity.rows[0];
  if (!team) {
    return {
      status: access.tbaConfigured ? "empty" : "setup_required",
      message: access.tbaConfigured
        ? `Team ${teamNumber} is not in the Neon TBA teams cache yet. Sync reference data, then retry.`
        : "Team identity cache is empty and TBA is not configured. Set TBA_AUTH_KEY (or a credential), sync, then open the dossier.",
      steps,
      orgId: row.orgId,
      teamNumber,
      referenceAccess: access,
    };
  }

  const year = new Date().getFullYear();
  const [yearMetrics, eventMetrics, operations, pitPhotos] = await Promise.all([
    client.query<{
      teamKey: string;
      year: number;
      epaTotal: number | null;
      epaAuto: number | null;
      epaTeleop: number | null;
      epaEndgame: number | null;
      source: string;
      syncedAt: string | null;
    }>(
      `SELECT DISTINCT ON (year)
          team_key AS "teamKey", year,
          epa_total AS "epaTotal", epa_auto AS "epaAuto",
          epa_teleop AS "epaTeleop", epa_endgame AS "epaEndgame",
          source, synced_at::text AS "syncedAt"
       FROM team_year_metrics
       WHERE team_key = $1 AND year BETWEEN $2 AND $3
       ORDER BY year DESC,
         CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
         synced_at DESC NULLS LAST`,
      [team.teamKey, year - 4, year],
    ),
    client.query<{
      teamKey: string;
      eventKey: string;
      year: number;
      epaTotal: number | null;
      epaAuto: number | null;
      epaTeleop: number | null;
      epaEndgame: number | null;
      wins: number | null;
      losses: number | null;
      ties: number | null;
      rank: number | null;
      source: string;
      syncedAt: string | null;
    }>(
      `SELECT DISTINCT ON (m.event_key)
          m.team_key AS "teamKey", m.event_key AS "eventKey", e.year,
          m.epa_total AS "epaTotal", m.epa_auto AS "epaAuto",
          m.epa_teleop AS "epaTeleop", m.epa_endgame AS "epaEndgame",
          m.wins, m.losses, m.ties, m.rank, m.source,
          m.synced_at::text AS "syncedAt"
       FROM team_event_metrics m
       JOIN events_ref e ON e.event_key = m.event_key
       WHERE m.team_key = $1 AND e.year BETWEEN $2 AND $3
       ORDER BY m.event_key,
         CASE m.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
         m.synced_at DESC NULLS LAST`,
      [team.teamKey, year - 1, year],
    ),
    loadSeasonScoutOps(client, row.orgId, team.teamKey),
    loadDossierPitPhotos(client, row.orgId, team.teamKey).catch(() => [] as DossierPitPhoto[]),
  ]);

  const yearRows: YearMetricRow[] = yearMetrics.rows.map((metric) => ({
    teamKey: metric.teamKey,
    year: metric.year,
    source: metric.source,
    epaTotal: metric.epaTotal,
    epaAuto: metric.epaAuto,
    epaTeleop: metric.epaTeleop,
    epaEndgame: metric.epaEndgame,
    syncedAt: metric.syncedAt,
  }));

  const eventRows: EventMetricRow[] = eventMetrics.rows.map((metric) => ({
    teamKey: metric.teamKey,
    year: metric.year,
    eventKey: metric.eventKey,
    source: metric.source,
    epaTotal: metric.epaTotal,
    epaAuto: metric.epaAuto,
    epaTeleop: metric.epaTeleop,
    epaEndgame: metric.epaEndgame,
    wins: metric.wins,
    losses: metric.losses,
    ties: metric.ties,
    rank: metric.rank,
    syncedAt: metric.syncedAt,
  }));

  const cards = buildTeamDossierFacts({
    identity: {
      teamKey: team.teamKey,
      teamNumber: team.teamNumber,
      nickname: team.nickname,
      name: team.name,
      city: team.city,
      stateProv: team.stateProv,
      country: team.country,
      rookieYear: team.rookieYear,
      source: "tba",
      syncedAt: team.syncedAt,
    },
    yearMetrics: yearRows,
    eventMetrics: eventRows,
    operations,
    maxSeasonYears: 4,
  });

  const hasReferenceFacts = dossierHasReferenceFacts(cards);
  if (!hasReferenceFacts && !access.statbotics.cacheHasMetrics && !access.cacheHasSync) {
    return {
      status: "setup_required",
      message:
        "No cited TBA/Statbotics/scout facts yet. Sync reference data so season EPA and event records land in Neon.",
      steps,
      orgId: row.orgId,
      teamNumber: team.teamNumber,
      referenceAccess: access,
    };
  }

  if (!hasReferenceFacts) {
    return {
      status: "empty",
      message: access.statbotics.cacheHasMetrics
        ? `Team ${team.teamNumber} is in cache, but this team has no season EPA, event records, or scout notes to cite yet.`
        : `Team ${team.teamNumber} identity is cached, but Statbotics EPA cache is empty for this team. Sync reference data — Vantage will not invent EPA.`,
      steps,
      orgId: row.orgId,
      teamNumber: team.teamNumber,
      referenceAccess: access,
    };
  }

  return {
    status: "live",
    orgId: row.orgId,
    teamNumber: team.teamNumber,
    teamKey: team.teamKey,
    nickname: team.nickname,
    name: team.name,
    cards,
    hasReferenceFacts,
    referenceAccess: access,
    pitPhotos,
    computedAt: new Date().toISOString(),
  };
}
