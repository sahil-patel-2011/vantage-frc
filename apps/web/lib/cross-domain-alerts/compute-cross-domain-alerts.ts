import type { PoolClient } from "@neondatabase/serverless";
import { buildCrossDomainAlerts, isOpenDesignReview, summarizeCrossDomainAlerts } from ".";
import type {
  CrossDomainAlert,
  CrossDomainAlertSummary,
  OpenDesignReview,
  SubsystemEvent,
  SubsystemEventDomain,
  SubsystemEventSource,
  VersionComponent,
} from "./types";

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export type CrossDomainAlertsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type CrossDomainAlertsView =
  | {
      status: "setup_required";
      message: string;
      steps: CrossDomainAlertsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      events: SubsystemEvent[];
      openReviews: OpenDesignReview[];
      versions: VersionComponent[];
      alerts: CrossDomainAlert[];
      summary: CrossDomainAlertSummary;
      computedAt: string;
    };

type EventRow = {
  id: string;
  subsystem: string;
  domain: SubsystemEventDomain;
  title: string;
  description: string | null;
  source: SubsystemEventSource;
  sourceRef: string | null;
  occurredAt: string;
  seasonYear: number;
};

type ReviewRow = {
  id: string;
  title: string;
  subsystem: string;
  stage: string;
  status: string;
  scheduledOn: string | null;
};

type VersionRow = {
  id: string;
  component: string;
  category: string;
  installedVersion: string;
  targetVersion: string | null;
};

function mapEvent(row: EventRow): SubsystemEvent {
  return {
    id: row.id,
    subsystem: row.subsystem,
    domain: row.domain,
    title: row.title,
    description: row.description,
    source: row.source,
    sourceRef: row.sourceRef,
    occurredAt: row.occurredAt,
    seasonYear: row.seasonYear,
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

export async function computeCrossDomainAlertsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<CrossDomainAlertsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to see cross-domain alerts.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [eventResult, reviewResult, versionResult, ackResult, seasonResult] = await Promise.all([
    client.query<EventRow>(
      `SELECT id, subsystem, domain, title, description, source, source_ref AS "sourceRef",
              occurred_at::text AS "occurredAt", season_year AS "seasonYear"
       FROM cross_domain_alerts_subsystem_events
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_at DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<ReviewRow>(
      `SELECT id, title, subsystem, stage, status, scheduled_on::text AS "scheduledOn"
       FROM design_reviews
       WHERE org_id = $1 AND season_year = $2 AND status IN ('scheduled','in_review')
       ORDER BY scheduled_on ASC NULLS LAST`,
      [org.orgId, seasonYear],
    ),
    client.query<VersionRow>(
      `SELECT id, component, category, installed_version AS "installedVersion", target_version AS "targetVersion"
       FROM software_versions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY component ASC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ alertKey: string }>(
      `SELECT alert_key AS "alertKey" FROM cross_domain_alerts_acks WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM cross_domain_alerts_subsystem_events WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const events = eventResult.rows.map(mapEvent);
  const openReviews: OpenDesignReview[] = reviewResult.rows
    .filter((row) => isOpenDesignReview(row.status))
    .map((row) => ({
      id: row.id,
      title: row.title,
      subsystem: row.subsystem,
      stage: row.stage,
      status: row.status,
      scheduledOn: row.scheduledOn,
    }));
  const versions: VersionComponent[] = versionResult.rows.map((row) => ({
    id: row.id,
    component: row.component,
    category: row.category,
    installedVersion: row.installedVersion,
    targetVersion: row.targetVersion,
  }));
  const acknowledgedKeys = new Set(ackResult.rows.map((r) => r.alertKey));

  const alerts = buildCrossDomainAlerts({ events, openReviews, versions, acknowledgedKeys });
  const summary = summarizeCrossDomainAlerts(alerts);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    events,
    openReviews,
    versions,
    alerts,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logSubsystemEvent(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    subsystem: string;
    domain: SubsystemEventDomain;
    title: string;
    description: string | null;
    occurredAt: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO cross_domain_alerts_subsystem_events (
       org_id, subsystem, domain, title, description, source, occurred_at, season_year, logged_by
     ) VALUES ($1,$2,$3,$4,$5,'manual', COALESCE($6::timestamptz, now()), $7, $8)`,
    [
      input.orgId,
      input.subsystem,
      input.domain,
      input.title,
      input.description,
      input.occurredAt,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function deleteSubsystemEvent(
  client: PoolClient,
  input: { orgId: string; eventId: string },
): Promise<void> {
  await client.query(`DELETE FROM cross_domain_alerts_subsystem_events WHERE id = $1 AND org_id = $2`, [
    input.eventId,
    input.orgId,
  ]);
}

export async function acknowledgeAlert(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; alertKey: string; note: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO cross_domain_alerts_acks (org_id, season_year, alert_key, note, acknowledged_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id, season_year, alert_key) DO UPDATE SET note = EXCLUDED.note`,
    [input.orgId, input.seasonYear, input.alertKey, input.note, input.userId],
  );
}
