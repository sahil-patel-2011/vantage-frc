import type { PoolClient } from "@neondatabase/serverless";
import { classifyMatchDelta, sortAlerts, summarizeAlerts } from ".";
import type {
  MatchDeltaAlert,
  MatchDeltaAlertType,
  MatchDeltaAlliance,
  MatchDeltaConfig,
  MatchDeltaSeverity,
  MatchDeltaSummary,
} from "./types";

export const DEFAULT_UPSET_THRESHOLD = 0.65;

export type MatchDeltaSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MatchDeltaWatcherView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchDeltaSetupStep[];
      orgId: string | null;
      eventKey: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string;
      events: string[];
      config: MatchDeltaConfig | null;
      alerts: MatchDeltaAlert[];
      summary: MatchDeltaSummary;
      computedAt: string;
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

async function resolveEventKey(
  client: PoolClient,
  orgId: string,
  requestedEvent: string | null,
): Promise<string | null> {
  if (requestedEvent) return requestedEvent;
  const configResult = await client.query<{ eventKey: string }>(
    `SELECT event_key AS "eventKey" FROM match_delta_watcher_configs
     WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  if (configResult.rows[0]) return configResult.rows[0].eventKey;

  const predictedEvent = await client.query<{ eventKey: string }>(
    `SELECT m.event_key AS "eventKey"
     FROM predictions p
     JOIN matches_ref m ON m.match_key = p.match_key
     WHERE p.org_id = $1
       AND COALESCE(p.model_version, '') !~* 'demo'
       AND COALESCE(p.caveats::text, '') !~* 'demo'
     ORDER BY p.scored_at DESC LIMIT 1`,
    [orgId],
  );
  return predictedEvent.rows[0]?.eventKey ?? null;
}

type ConfigRow = {
  id: string;
  eventKey: string;
  enabled: boolean;
  upsetThreshold: number;
  createdAt: string;
  updatedAt: string;
};

type AlertRow = {
  id: string;
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  alertType: MatchDeltaAlertType;
  severity: MatchDeltaSeverity;
  predictedWinner: MatchDeltaAlliance | null;
  actualWinner: MatchDeltaAlliance | null;
  predictedProbability: number | null;
  summary: string;
  teamsInvolved: string[] | null;
  acknowledged: boolean;
  createdAt: string;
};

function mapAlert(row: AlertRow): MatchDeltaAlert {
  return {
    id: row.id,
    matchKey: row.matchKey,
    eventKey: row.eventKey,
    compLevel: row.compLevel,
    matchNumber: Number(row.matchNumber) || 0,
    alertType: row.alertType,
    severity: row.severity,
    predictedWinner: row.predictedWinner,
    actualWinner: row.actualWinner,
    predictedProbability: row.predictedProbability != null ? Number(row.predictedProbability) : null,
    summary: row.summary,
    teamsInvolved: Array.isArray(row.teamsInvolved) ? row.teamsInvolved : [],
    acknowledged: row.acknowledged,
    createdAt: row.createdAt,
  };
}

export async function computeMatchDeltaWatcherView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; requestedEvent?: string | null },
): Promise<MatchDeltaWatcherView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to watch live match deltas.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      eventKey: null,
    };
  }

  const eventKey = await resolveEventKey(client, org.orgId, input.requestedEvent ?? null);
  if (!eventKey) {
    return {
      status: "setup_required",
      message: "Generate match predictions for an event before watching for deltas.",
      steps: [
        {
          id: "predictions",
          label: "Score predictions",
          detail: "Run the prediction model for an upcoming event",
          href: "/strategy",
        },
      ],
      orgId: org.orgId,
      eventKey: null,
    };
  }

  const [configResult, eventsResult, alertsResult, accuracyResult] = await Promise.all([
    client.query<ConfigRow>(
      `SELECT id, event_key AS "eventKey", enabled, upset_threshold AS "upsetThreshold",
              created_at::text AS "createdAt", updated_at::text AS "updatedAt"
       FROM match_delta_watcher_configs WHERE org_id = $1 AND event_key = $2 LIMIT 1`,
      [org.orgId, eventKey],
    ),
    client.query<{ eventKey: string }>(
      `SELECT DISTINCT m.event_key AS "eventKey"
       FROM predictions p JOIN matches_ref m ON m.match_key = p.match_key
       WHERE p.org_id = $1
         AND COALESCE(p.model_version, '') !~* 'demo'
         AND COALESCE(p.caveats::text, '') !~* 'demo'
       ORDER BY m.event_key DESC`,
      [org.orgId],
    ),
    client.query<AlertRow>(
      // Every alert column stays qualified with `a`: matches_ref also has
      // match_key/event_key, so the unqualified names raised
      // `column reference "match_key" is ambiguous` and the alert list never loaded
      // once a team actually had alerts to show.
      `SELECT a.id, a.match_key AS "matchKey", a.event_key AS "eventKey", m.comp_level AS "compLevel",
              m.match_number AS "matchNumber", a.alert_type AS "alertType", a.severity,
              a.predicted_winner AS "predictedWinner", a.actual_winner AS "actualWinner",
              a.predicted_probability AS "predictedProbability", a.summary,
              a.teams_involved AS "teamsInvolved", a.acknowledged, a.created_at::text AS "createdAt"
       FROM match_delta_watcher_alerts a
       JOIN matches_ref m ON m.match_key = a.match_key
       WHERE a.org_id = $1 AND a.event_key = $2
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [org.orgId, eventKey],
    ),
    client.query<{ totalScored: string; correct: string }>(
      `SELECT
         count(*) FILTER (WHERE p.actual_winner IS NOT NULL) AS "totalScored",
         count(*) FILTER (
           WHERE p.actual_winner IS NOT NULL AND (
             (p.actual_winner = 'red' AND p.p_red > p.p_blue) OR
             (p.actual_winner = 'blue' AND p.p_blue > p.p_red) OR
             (p.actual_winner = 'tie' AND p.p_red = p.p_blue)
           )
         ) AS "correct"
       FROM predictions p
       JOIN matches_ref m ON m.match_key = p.match_key
       WHERE p.org_id = $1 AND m.event_key = $2
         AND COALESCE(p.model_version, '') !~* 'demo'
         AND COALESCE(p.caveats::text, '') !~* 'demo'`,
      [org.orgId, eventKey],
    ),
  ]);

  const alerts = sortAlerts(alertsResult.rows.map(mapAlert));
  const totalScored = Number(accuracyResult.rows[0]?.totalScored ?? 0);
  const correct = Number(accuracyResult.rows[0]?.correct ?? 0);
  const summary = summarizeAlerts(alerts, totalScored, correct);
  const events = eventsResult.rows.map((r) => r.eventKey);
  if (!events.includes(eventKey)) events.unshift(eventKey);

  const configRow = configResult.rows[0];
  const config: MatchDeltaConfig | null = configRow
    ? {
        id: configRow.id,
        eventKey: configRow.eventKey,
        enabled: configRow.enabled,
        upsetThreshold: Number(configRow.upsetThreshold),
        createdAt: configRow.createdAt,
        updatedAt: configRow.updatedAt,
      }
    : null;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey,
    events,
    config,
    alerts,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function upsertConfig(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; enabled: boolean; upsetThreshold: number },
): Promise<void> {
  await client.query(
    `INSERT INTO match_delta_watcher_configs (org_id, event_key, enabled, upset_threshold, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, event_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       upset_threshold = EXCLUDED.upset_threshold,
       updated_at = now()`,
    [input.orgId, input.eventKey, input.enabled, input.upsetThreshold, input.userId],
  );
}

export async function acknowledgeAlert(
  client: PoolClient,
  input: { orgId: string; userId: string; alertId: string },
): Promise<void> {
  await client.query(
    `UPDATE match_delta_watcher_alerts
     SET acknowledged = true, acknowledged_by = $1, acknowledged_at = now()
     WHERE id = $2 AND org_id = $3`,
    [input.userId, input.alertId, input.orgId],
  );
}

type ScanMatchRow = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  pRed: number;
  pBlue: number;
  actualWinner: MatchDeltaAlliance;
  redAlliance: { team_keys?: string[] } | string[] | null;
  blueAlliance: { team_keys?: string[] } | string[] | null;
};

function teamKeysFromAlliance(value: ScanMatchRow["redAlliance"]): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (value && Array.isArray(value.team_keys)) return value.team_keys.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Scans an event's scored predictions against actual results and pick-list priorities, and
 * upserts delta alerts. Intended to be invoked on-demand (POST) and, going forward, from a cron
 * worker as official results land.
 */
export async function scanEventForDeltas(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey: string; upsetThreshold: number },
): Promise<number> {
  const [matchesResult, pickListResult] = await Promise.all([
    client.query<ScanMatchRow>(
      `SELECT p.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
              p.p_red AS "pRed", p.p_blue AS "pBlue", p.actual_winner AS "actualWinner",
              m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
       FROM predictions p
       JOIN matches_ref m ON m.match_key = p.match_key
       WHERE p.org_id = $1 AND m.event_key = $2 AND p.actual_winner IS NOT NULL
         AND COALESCE(p.model_version, '') !~* 'demo'
         AND COALESCE(p.caveats::text, '') !~* 'demo'`,
      [input.orgId, input.eventKey],
    ),
    client.query<{ teamKey: string; rank: number }>(
      `SELECT e.team_key AS "teamKey", e.rank
       FROM pick_list_entries e
       JOIN pick_lists l ON l.id = e.pick_list_id
       WHERE l.org_id = $1 AND l.event_key = $2
       ORDER BY l.updated_at DESC`,
      [input.orgId, input.eventKey],
    ),
  ]);

  const pickListRanks: Record<string, number> | null = pickListResult.rows.length
    ? Object.fromEntries(pickListResult.rows.map((r) => [r.teamKey, Number(r.rank)]))
    : null;

  let written = 0;
  for (const match of matchesResult.rows) {
    const pRed = Number(match.pRed);
    const pBlue = Number(match.pBlue);
    const predictedWinner: MatchDeltaAlliance = pRed === pBlue ? "tie" : pRed > pBlue ? "red" : "blue";
    const redTeams = teamKeysFromAlliance(match.redAlliance);
    const blueTeams = teamKeysFromAlliance(match.blueAlliance);

    const classifications = classifyMatchDelta({
      predictedWinner,
      actualWinner: match.actualWinner,
      pRed,
      pBlue,
      redTeams,
      blueTeams,
      pickListRanks,
      upsetThreshold: input.upsetThreshold,
    });

    for (const classification of classifications) {
      await client.query(
        `INSERT INTO match_delta_watcher_alerts (
           org_id, event_key, match_key, alert_type, severity, predicted_winner, actual_winner,
           predicted_probability, summary, teams_involved, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11)
         ON CONFLICT (org_id, match_key, alert_type) DO UPDATE SET
           severity = EXCLUDED.severity,
           predicted_winner = EXCLUDED.predicted_winner,
           actual_winner = EXCLUDED.actual_winner,
           predicted_probability = EXCLUDED.predicted_probability,
           summary = EXCLUDED.summary,
           teams_involved = EXCLUDED.teams_involved`,
        [
          input.orgId,
          input.eventKey,
          match.matchKey,
          classification.alertType,
          classification.severity,
          predictedWinner,
          match.actualWinner,
          Math.max(pRed, pBlue),
          classification.summary,
          classification.teamsInvolved,
          input.userId,
        ],
      );
      written += 1;
    }
  }
  return written;
}
