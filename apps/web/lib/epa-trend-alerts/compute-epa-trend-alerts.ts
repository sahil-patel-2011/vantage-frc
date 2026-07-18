import type { PoolClient } from "@neondatabase/serverless";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { buildTeamTrendAlert, fingerprintAlert, summarizeAlerts } from ".";
import type { EpaTrendAlert, EpaTrendPoint, EpaTrendSummary, WatchlistTeam } from "./types";

export type EpaTrendAlertsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type EpaTrendAlertsView =
  | {
      status: "setup_required";
      message: string;
      steps: EpaTrendAlertsSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      watchlist: WatchlistTeam[];
      alerts: EpaTrendAlert[];
      summary: EpaTrendSummary;
      computedAt: string;
    };

type WatchlistRow = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  note: string | null;
  createdAt: string;
  nickname: string | null;
};

type MetricRow = {
  teamKey: string;
  eventKey: string;
  epaTotal: number | null;
  eventName: string | null;
  startDate: string | null;
};

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

function setupSteps(orgId: string | null): EpaTrendAlertsSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — EPA Trend Alerts is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists stay empty until real metrics exist — never DEMO EPA.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "opponent-watchlist",
      label: "Open Opponent Watchlist",
      detail: "Manual opponent notes stay blank until logged — never DEMO rankings.",
      href: hubHref("/competition", "opponent-watchlist", orgId),
    },
  ];
}

function setupRequiredView(orgId: string | null = null): EpaTrendAlertsView {
  return {
    status: "setup_required",
    message: "Select a team workspace to build an EPA trend watchlist.",
    steps: setupSteps(orgId),
    orgId,
  };
}

export async function computeEpaTrendAlertsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<EpaTrendAlertsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequiredView();

  const watchlistResult = await client.query<WatchlistRow>(
    `SELECT w.id, w.team_key AS "teamKey", w.team_number AS "teamNumber", w.note,
            w.created_at::text AS "createdAt", t.nickname
     FROM epa_trend_alerts_watchlist w
     LEFT JOIN teams_ref t ON t.team_key = w.team_key
     WHERE w.org_id = $1
     ORDER BY w.created_at DESC`,
    [org.orgId],
  );
  const watchlist: WatchlistTeam[] = watchlistResult.rows.map((row) => ({
    id: row.id,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    nickname: row.nickname,
    note: row.note,
    createdAt: row.createdAt,
  }));

  if (watchlist.length === 0) {
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      watchlist: [],
      alerts: [],
      summary: summarizeAlerts([], 0),
      computedAt: new Date().toISOString(),
    };
  }

  const teamKeys = watchlist.map((team) => team.teamKey);

  const [metricsResult, dismissalsResult] = await Promise.all([
    client.query<MetricRow>(
      `SELECT tem.team_key AS "teamKey", tem.event_key AS "eventKey", tem.epa_total AS "epaTotal",
              COALESCE(er.short_name, er.name) AS "eventName", er.start_date::text AS "startDate"
       FROM team_event_metrics tem
       JOIN events_ref er ON er.event_key = tem.event_key
       WHERE tem.team_key = ANY($1::text[]) AND tem.epa_total IS NOT NULL
       ORDER BY tem.team_key, er.start_date ASC NULLS LAST, tem.event_key ASC`,
      [teamKeys],
    ),
    client.query<{ teamKey: string; alertFingerprint: string }>(
      `SELECT team_key AS "teamKey", alert_fingerprint AS "alertFingerprint"
       FROM epa_trend_alerts_dismissals
       WHERE org_id = $1`,
      [org.orgId],
    ),
  ]);

  const pointsByTeam = new Map<string, EpaTrendPoint[]>();
  for (const row of metricsResult.rows) {
    if (row.epaTotal == null) continue;
    const list = pointsByTeam.get(row.teamKey) ?? [];
    list.push({
      eventKey: row.eventKey,
      eventName: row.eventName,
      startDate: row.startDate,
      epaTotal: Number(row.epaTotal),
    });
    pointsByTeam.set(row.teamKey, list);
  }

  const dismissedFingerprints = new Set(dismissalsResult.rows.map((row) => row.alertFingerprint));

  const alerts: EpaTrendAlert[] = [];
  for (const team of watchlist) {
    const alert = buildTeamTrendAlert({
      teamKey: team.teamKey,
      teamNumber: team.teamNumber,
      nickname: team.nickname,
      points: pointsByTeam.get(team.teamKey) ?? [],
      dismissedFingerprints,
    });
    if (alert) alerts.push(alert);
  }
  alerts.sort((a, b) => Math.abs(b.magnitude) - Math.abs(a.magnitude));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    watchlist,
    alerts,
    summary: summarizeAlerts(alerts, watchlist.length),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addWatchlistTeam(
  client: PoolClient,
  input: { orgId: string; userId: string; teamNumber: number; note: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const teamResult = await client.query<{ teamKey: string }>(
    `SELECT team_key AS "teamKey" FROM teams_ref WHERE team_number = $1`,
    [input.teamNumber],
  );
  const teamKey = teamResult.rows[0]?.teamKey;
  if (!teamKey) return { ok: false, error: "Unknown team number — no reference data found." };

  await client.query(
    `INSERT INTO epa_trend_alerts_watchlist (org_id, team_key, team_number, note, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, team_key) DO UPDATE SET note = EXCLUDED.note`,
    [input.orgId, teamKey, input.teamNumber, input.note, input.userId],
  );
  return { ok: true };
}

export async function removeWatchlistTeam(
  client: PoolClient,
  input: { orgId: string; watchlistId: string },
): Promise<void> {
  await client.query(`DELETE FROM epa_trend_alerts_watchlist WHERE id = $1 AND org_id = $2`, [
    input.watchlistId,
    input.orgId,
  ]);
}

export async function dismissAlert(
  client: PoolClient,
  input: { orgId: string; userId: string; teamKey: string; latestEventKey: string },
): Promise<void> {
  const alertFingerprint = fingerprintAlert(input.teamKey, input.latestEventKey);
  await client.query(
    `INSERT INTO epa_trend_alerts_dismissals (org_id, team_key, alert_fingerprint, dismissed_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, team_key, alert_fingerprint) DO NOTHING`,
    [input.orgId, input.teamKey, alertFingerprint, input.userId],
  );
}
