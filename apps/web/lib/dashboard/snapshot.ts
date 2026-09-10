import type { PoolClient } from "@neondatabase/serverless";
import { platformTbaEnvConfigured } from "@vantage/reference";
import { buildOnboardingChecklistSteps } from "../onboarding-workflow";
import { canAccessWidget, type DashboardWidgetType } from "./catalog";
import {
  buildMentorHomeStrip,
  buildStudentHomeStrip,
  homeAudienceFromTeamRole,
} from "../home-workflows";
import { countLodgingGaps } from "../logistics";
import { snapshotShouldLoadHomeStrip } from "./refresh";
import { isDemoPrediction } from "../strategy/prediction-display";
import { isNextMatchScoreSkip, nextMatchScoreCard, seasonYearFromEventKey } from "./score-from-metrics";
import { HOME_WIDGET_TYPES, loadHomeWidget } from "./home-widget-loaders";

export type WidgetDataStatus = "live" | "empty" | "setup_required";

export type WidgetPayload = {
  type: DashboardWidgetType;
  status: WidgetDataStatus;
  updatedAt: string;
  message?: string;
  data?: Record<string, unknown>;
};

function stamp(status: WidgetDataStatus, type: DashboardWidgetType, data?: Record<string, unknown>, message?: string): WidgetPayload {
  return { type, status, updatedAt: new Date().toISOString(), data, message };
}

export async function loadDashboardSnapshot(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    role: string | null;
    /** Omit to preserve the full administrative/debug snapshot. */
    widgetTypes?: DashboardWidgetType[];
    /** Mentor/student focus strip. Defaults on only for unfiltered snapshots. */
    includeHomeStrip?: boolean;
  },
): Promise<{ context: Record<string, unknown>; widgets: Record<string, WidgetPayload> }> {
  const [org, tbaMeta, profileMeta] = await Promise.all([
    client.query<{
      name: string;
      teamNumber: number | null;
      eventKey: string | null;
      eventName: string | null;
      fundingModel: string | null;
    }>(
      `SELECT o.name, o.team_number AS "teamNumber", c.active_event_key AS "eventKey", e.name AS "eventName",
              o.funding_model::text AS "fundingModel"
       FROM organizations o
       LEFT JOIN org_active_context c ON c.org_id = o.id
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
       WHERE o.id = $1`,
      [input.orgId],
    ),
    client.query<{ credential: boolean; cache: boolean }>(
      `SELECT
         EXISTS(
           SELECT 1 FROM data_source_credentials
           WHERE source = 'tba' AND disabled_at IS NULL
             AND (org_id IS NULL OR org_id = $1)
         ) AS credential,
         EXISTS(SELECT 1 FROM matches_ref LIMIT 1)
           OR EXISTS(SELECT 1 FROM team_event_metrics LIMIT 1) AS cache`,
      [input.orgId],
    ),
    client.query<{ teamRole: string | null; primaryFocus: string | null }>(
      `SELECT team_role AS "teamRole", primary_focus AS "primaryFocus"
       FROM profiles WHERE user_id = $1`,
      [input.userId],
    ),
  ]);
  const row = org.rows[0];
  if (!row) {
    return {
      context: { setupRequired: true },
      widgets: {},
    };
  }

  const teamKey = row.teamNumber ? `frc${row.teamNumber}` : null;
  const eventKey = row.eventKey;
  const platformEnvKey = platformTbaEnvConfigured();
  const tbaConfigured =
    platformEnvKey || Boolean(tbaMeta.rows[0]?.credential) || Boolean(tbaMeta.rows[0]?.cache);

  const [scoutingMeta, aiMeta] = await Promise.all([
    eventKey
      ? client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM scout_schemas WHERE org_id = $1 AND year = (
             SELECT year FROM events_ref WHERE event_key = $2
           )`,
          [input.orgId, eventKey],
        )
      : Promise.resolve({ rows: [{ count: "0" }] }),
    client.query<{ hasKey: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM org_llm_keys WHERE org_id = $1
       ) OR EXISTS(
         SELECT 1 FROM org_provider_configs
         WHERE org_id = $1 AND enabled = true AND key_ciphertext IS NOT NULL
       ) AS "hasKey"`,
      [input.orgId],
    ),
  ]);

  const hasScoutingSchemas = Number(scoutingMeta.rows[0]?.count ?? 0) > 0;
  const hasAiProvider = Boolean(aiMeta.rows[0]?.hasKey);

  const teamRole = profileMeta.rows[0]?.teamRole ?? null;
  const audience = homeAudienceFromTeamRole(teamRole);

  const context: Record<string, unknown> = {
    orgName: row.name,
    teamNumber: row.teamNumber,
    eventKey,
    eventName: row.eventName,
    role: input.role,
    teamRole,
    homeAudience: audience,
    setupRequired: !eventKey || !teamKey,
    tbaConfigured,
    hasScoutingSchemas,
    hasAiProvider,
    fundingModel: row.fundingModel,
  };

  const widgets: Record<string, WidgetPayload> = {};
  const requestedTypes = input.widgetTypes ? new Set(input.widgetTypes) : null;
  const wants = (type: DashboardWidgetType) => requestedTypes === null || requestedTypes.has(type);

  async function nextMatch() {
    if (!eventKey || !teamKey) {
      widgets.next_match = stamp("setup_required", "next_match", undefined, "Select an active event and team workspace.");
      return;
    }
    const match = await client.query<{
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      scheduledTime: string | null;
      redAlliance: unknown;
      blueAlliance: unknown;
    }>(
      `SELECT match_key AS "matchKey", comp_level AS "compLevel", match_number AS "matchNumber",
              COALESCE(predicted_time, event_time)::text AS "scheduledTime",
              red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
       FROM matches_ref
       WHERE event_key = $1
         AND (
           red_alliance->'teamKeys' ? $2
           OR blue_alliance->'teamKeys' ? $2
         )
         AND COALESCE(actual_time, predicted_time, event_time) > now()
       ORDER BY COALESCE(actual_time, predicted_time, event_time)
       LIMIT 1`,
      [eventKey, teamKey],
    );
    if (!match.rows[0]) {
      widgets.next_match = stamp("empty", "next_match", undefined, "No upcoming match found for your team at this event.");
      return;
    }
    const row = match.rows[0];
    const redKeys = Array.isArray((row.redAlliance as { teamKeys?: unknown } | null)?.teamKeys)
      ? ((row.redAlliance as { teamKeys: unknown[] }).teamKeys as unknown[]).map(String)
      : [];
    const blueKeys = Array.isArray((row.blueAlliance as { teamKeys?: unknown } | null)?.teamKeys)
      ? ((row.blueAlliance as { teamKeys: unknown[] }).teamKeys as unknown[]).map(String)
      : [];
    const ourAlliance = redKeys.includes(teamKey) ? "red" : blueKeys.includes(teamKey) ? "blue" : null;
    const partnerKeys = (ourAlliance === "red" ? redKeys : ourAlliance === "blue" ? blueKeys : []).filter(
      (key) => key !== teamKey,
    );
    const opponentKeys = ourAlliance === "red" ? blueKeys : ourAlliance === "blue" ? redKeys : [];
    const strip = (key: string) => key.replace(/^frc/i, "");
    const pred = await client.query<{
      pRed: number;
      pBlue: number;
      confidenceLow: number;
      confidenceHigh: number;
      keyFactors: unknown;
      modelVersion: string;
    }>(
      `SELECT p_red AS "pRed", p_blue AS "pBlue",
              confidence_low AS "confidenceLow", confidence_high AS "confidenceHigh",
              key_factors AS "keyFactors", model_version AS "modelVersion"
       FROM predictions
       WHERE org_id = $1::uuid AND match_key = $2
       ORDER BY scored_at DESC
       LIMIT 1`,
      [input.orgId, row.matchKey],
    );
    const stored = pred.rows[0];
    const year = seasonYearFromEventKey(eventKey);
    let redPredicted: number | null = null;
    let bluePredicted: number | null = null;
    let errorBand: number | null = null;
    let scoreDrivers: string[] = [];
    let briefing: string | null = null;
    if (year && (redKeys.length >= 2 || blueKeys.length >= 2)) {
      const epa = await client.query<{
        teamKey: string;
        autoEpa: number | null;
        teleopEpa: number | null;
        endgameEpa: number | null;
      }>(
        `SELECT DISTINCT ON (team_key)
            team_key AS "teamKey",
            epa_auto AS "autoEpa",
            epa_teleop AS "teleopEpa",
            epa_endgame AS "endgameEpa"
         FROM team_year_metrics
         WHERE team_key = ANY($1::text[]) AND year = $2
         ORDER BY team_key,
           CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
           synced_at DESC NULLS LAST`,
        [[...redKeys, ...blueKeys], year],
      );
      const card = nextMatchScoreCard({
        matchKey: row.matchKey,
        ourAlliance,
        redKeys,
        blueKeys,
        rows: epa.rows,
      });
      if (!isNextMatchScoreSkip(card)) {
        redPredicted = card.redPredicted;
        bluePredicted = card.bluePredicted;
        errorBand = card.errorBand;
        scoreDrivers = card.drivers;
        briefing = card.briefing;
      }
    }
    widgets.next_match = stamp("live", "next_match", {
      ...row,
      ourAlliance,
      partners: partnerKeys.map(strip),
      opponents: opponentKeys.map(strip),
      bumperCue:
        ourAlliance === "red"
          ? "Switch to RED bumpers"
          : ourAlliance === "blue"
            ? "Switch to BLUE bumpers"
            : "Alliance TBD — confirm bumpers",
      bumperColor: ourAlliance ? ourAlliance.toUpperCase() : null,
      href: `/my-day?orgId=${encodeURIComponent(input.orgId)}`,
      pRed: stored?.pRed ?? null,
      pBlue: stored?.pBlue ?? null,
      confidenceLow: stored?.confidenceLow ?? null,
      confidenceHigh: stored?.confidenceHigh ?? null,
      keyFactors: stored?.keyFactors ?? null,
      modelVersion: stored?.modelVersion ?? null,
      redPredicted,
      bluePredicted,
      errorBand,
      scoreDrivers,
      briefing,
    } as unknown as Record<string, unknown>);
  }

  async function recentResult() {
    if (!eventKey || !teamKey) {
      widgets.recent_result = stamp("setup_required", "recent_result", undefined, "Select an active event and team workspace.");
      return;
    }
    const match = await client.query<{
      matchKey: string;
      compLevel: string;
      matchNumber: number;
      redAlliance: { score?: number | null; teamKeys?: string[] };
      blueAlliance: { score?: number | null; teamKeys?: string[] };
    }>(
      `SELECT match_key AS "matchKey", comp_level AS "compLevel", match_number AS "matchNumber",
              red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
       FROM matches_ref
       WHERE event_key = $1
         AND (
           red_alliance->'teamKeys' ? $2
           OR blue_alliance->'teamKeys' ? $2
         )
         AND (red_alliance->>'score') IS NOT NULL
       ORDER BY COALESCE(actual_time, predicted_time, event_time) DESC NULLS LAST
       LIMIT 1`,
      [eventKey, teamKey],
    );
    const item = match.rows[0];
    if (!item) {
      widgets.recent_result = stamp("empty", "recent_result", undefined, "No scored matches yet.");
      return;
    }
    const onRed = (item.redAlliance?.teamKeys ?? []).includes(teamKey);
    const us = onRed ? Number(item.redAlliance?.score ?? 0) : Number(item.blueAlliance?.score ?? 0);
    const opp = onRed ? Number(item.blueAlliance?.score ?? 0) : Number(item.redAlliance?.score ?? 0);
    const result = us === opp ? "T" : us > opp ? "W" : "L";
    widgets.recent_result = stamp("live", "recent_result", {
      matchKey: item.matchKey,
      compLevel: item.compLevel,
      matchNumber: item.matchNumber,
      result,
      us,
      opp,
      margin: us - opp,
    });
  }

  async function competitionSnapshot() {
    if (!teamKey) {
      widgets.competition_snapshot = stamp(
        "setup_required",
        "competition_snapshot",
        undefined,
        "Select a team workspace so Statbotics/TBA EPA can load.",
      );
      return;
    }
    if (eventKey) {
      const metrics = await client.query<{
        epaTotal: number | null;
        epaAuto: number | null;
        epaTeleop: number | null;
        epaEndgame: number | null;
        rank: number | null;
        wins: number | null;
        losses: number | null;
        ties: number | null;
        source: string;
        syncedAt: string | null;
      }>(
        `SELECT epa_total AS "epaTotal", epa_auto AS "epaAuto", epa_teleop AS "epaTeleop", epa_endgame AS "epaEndgame",
                rank, wins, losses, ties, source, synced_at::text AS "syncedAt"
         FROM team_event_metrics
         WHERE team_key = $1 AND event_key = $2
         ORDER BY CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END, synced_at DESC
         LIMIT 1`,
        [teamKey, eventKey],
      );
      if (metrics.rows[0]) {
        const m = metrics.rows[0];
        widgets.competition_snapshot = stamp("live", "competition_snapshot", {
          ...m,
          record: `${m.wins ?? 0}-${m.losses ?? 0}-${m.ties ?? 0}`,
          scope: "event",
        });
        return;
      }
    }
    // No event metrics yet — fall back to year EPA from Neon Statbotics cache (never invent).
    const year = new Date().getFullYear();
    const yearMetrics = await client.query<{
      epaTotal: number | null;
      epaAuto: number | null;
      epaTeleop: number | null;
      epaEndgame: number | null;
      source: string;
      syncedAt: string | null;
      year: number;
    }>(
      `SELECT epa_total AS "epaTotal", epa_auto AS "epaAuto", epa_teleop AS "epaTeleop", epa_endgame AS "epaEndgame",
              source, synced_at::text AS "syncedAt", year
       FROM team_year_metrics
       WHERE team_key = $1 AND year = $2
       ORDER BY CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END, synced_at DESC
       LIMIT 1`,
      [teamKey, year],
    );
    if (yearMetrics.rows[0]) {
      const m = yearMetrics.rows[0];
      widgets.competition_snapshot = stamp("live", "competition_snapshot", {
        epaTotal: m.epaTotal,
        epaAuto: m.epaAuto,
        epaTeleop: m.epaTeleop,
        epaEndgame: m.epaEndgame,
        rank: null,
        wins: null,
        losses: null,
        ties: null,
        source: m.source,
        syncedAt: m.syncedAt,
        record: `${m.year} season`,
        scope: "year",
      });
      return;
    }
    widgets.competition_snapshot = stamp(
      eventKey ? "empty" : "setup_required",
      "competition_snapshot",
      undefined,
      eventKey
        ? "Statbotics/TBA metrics not synced for this team yet — open Team → Data."
        : "Set an active event or sync Statbotics year EPA under Team → Data.",
    );
  }

  async function scoutingCoverage() {
    if (!eventKey) {
      widgets.scouting_coverage = stamp("setup_required", "scouting_coverage", undefined, "Select an active event.");
      return;
    }
    const counts = await client.query<{
      assignments: string;
      reports: string;
      openDisagreements: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM scout_assignments a WHERE a.org_id = $1 AND a.event_key = $2) AS assignments,
         (SELECT count(*)::text FROM match_scout_entries s WHERE s.org_id = $1 AND s.event_key = $2) AS reports,
         (SELECT count(*)::text FROM scout_disagreements d WHERE d.org_id = $1 AND d.event_key = $2 AND d.status = 'open') AS "openDisagreements"`,
      [input.orgId, eventKey],
    );
    const c = counts.rows[0]!;
    widgets.scouting_coverage = stamp("live", "scouting_coverage", {
      assignments: Number(c.assignments),
      reports: Number(c.reports),
      openDisagreements: Number(c.openDisagreements),
    });
  }

  async function predictionSummary() {
    if (!eventKey) {
      widgets.prediction_summary = stamp("setup_required", "prediction_summary", undefined, "Select an active event.");
      return;
    }
    if (!teamKey) {
      widgets.prediction_summary = stamp(
        "setup_required",
        "prediction_summary",
        undefined,
        "Set a team number to show your next-match prediction.",
      );
      return;
    }
    const prediction = await client.query<{
      matchKey: string;
      pRed: number;
      pBlue: number;
      confidenceLow: number;
      confidenceHigh: number;
      modelVersion: string;
      keyFactors: unknown;
      scoredAt: string;
      redAlliance: unknown;
      blueAlliance: unknown;
    }>(
      `SELECT p.match_key AS "matchKey", p.p_red AS "pRed", p.p_blue AS "pBlue",
              p.confidence_low AS "confidenceLow", p.confidence_high AS "confidenceHigh",
              p.model_version AS "modelVersion", p.key_factors AS "keyFactors", p.scored_at::text AS "scoredAt",
              m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
       FROM predictions p
       JOIN matches_ref m ON m.match_key = p.match_key
       WHERE p.org_id = $1 AND m.event_key = $2
         AND (
           m.red_alliance->'teamKeys' ? $3
           OR m.blue_alliance->'teamKeys' ? $3
         )
         AND COALESCE(p.model_version, '') !~* 'demo'
       ORDER BY
         CASE WHEN COALESCE(m.actual_time, m.predicted_time, m.event_time) > now() THEN 0 ELSE 1 END,
         COALESCE(m.actual_time, m.predicted_time, m.event_time) ASC NULLS LAST,
         p.scored_at DESC
       LIMIT 1`,
      [input.orgId, eventKey, teamKey],
    );
    if (!prediction.rows[0]) {
      widgets.prediction_summary = stamp("empty", "prediction_summary", undefined, "No stored predictions for your team at this event yet.");
      return;
    }
    const row = prediction.rows[0];
    if (isDemoPrediction({ modelVersion: row.modelVersion, pRed: row.pRed, pBlue: row.pBlue })) {
      widgets.prediction_summary = stamp(
        "empty",
        "prediction_summary",
        undefined,
        "Last stored prediction is not from a real match. Open Strategy and compute one from your event.",
      );
      return;
    }
    const redKeys = Array.isArray((row.redAlliance as { teamKeys?: unknown } | null)?.teamKeys)
      ? ((row.redAlliance as { teamKeys: unknown[] }).teamKeys as unknown[]).map(String)
      : [];
    const blueKeys = Array.isArray((row.blueAlliance as { teamKeys?: unknown } | null)?.teamKeys)
      ? ((row.blueAlliance as { teamKeys: unknown[] }).teamKeys as unknown[]).map(String)
      : [];
    const ourAlliance = redKeys.includes(teamKey) ? "red" : blueKeys.includes(teamKey) ? "blue" : null;
    widgets.prediction_summary = stamp("live", "prediction_summary", {
      matchKey: row.matchKey,
      pRed: row.pRed,
      pBlue: row.pBlue,
      confidenceLow: row.confidenceLow,
      confidenceHigh: row.confidenceHigh,
      modelVersion: row.modelVersion,
      keyFactors: row.keyFactors,
      scoredAt: row.scoredAt,
      ourAlliance,
    });
  }

  async function syncStatus() {
    if (!tbaConfigured) {
      widgets.sync_status = stamp(
        "setup_required",
        "sync_status",
        undefined,
        "TBA not configured. Set TBA_AUTH_KEY (or save a platform/org TBA credential) before live match/rank sync.",
      );
      return;
    }
    const health = await client.query<{
      source: string;
      status: string;
      lastSuccessAt: string | null;
      consecutiveFailures: number;
    }>(
      `SELECT source, status, last_success_at::text AS "lastSuccessAt", consecutive_failures AS "consecutiveFailures"
       FROM data_source_health
       WHERE source IN ('tba', 'statbotics')
       ORDER BY source`,
    );
    if (!health.rowCount) {
      widgets.sync_status = stamp("setup_required", "sync_status", undefined, "Reference sync health is not available yet.");
      return;
    }
    widgets.sync_status = stamp("live", "sync_status", { sources: health.rows });
  }

  async function pitYoutube() {
    const board = await client.query<{ widgets: Array<{ type?: string; config?: { url?: string; title?: string } }> }>(
      `SELECT widgets FROM display_boards WHERE org_id = $1 AND name = 'Vantage Pit Stream' LIMIT 1`,
      [input.orgId],
    );
    const stream = board.rows[0]?.widgets?.find((widget) => widget.type === "pit_stream");
    const url = stream?.config?.url ?? "";
    if (!url) {
      widgets.pit_youtube = stamp("empty", "pit_youtube", { title: "Pit Screen" }, "No YouTube pit stream configured.");
      return;
    }
    widgets.pit_youtube = stamp("live", "pit_youtube", {
      url,
      title: stream?.config?.title ?? "Pit Screen",
    });
  }

  async function aiUsage() {
    if (!canAccessWidget("ai_usage", input.role)) {
      widgets.ai_usage = stamp("setup_required", "ai_usage", undefined, "Owner/admin access required.");
      return;
    }
    const [entitlement, models, wallet] = await Promise.all([
      client.query<{ planCode: string; includedAllowance: number }>(
        `SELECT e.plan_code AS "planCode", p.included_allowance_usd AS "includedAllowance"
         FROM org_entitlements e JOIN pricing_plans p ON p.code = e.plan_code WHERE e.org_id = $1`,
        [input.orgId],
      ),
      client.query<{ cost: string }>(
        `SELECT COALESCE(sum(cost_usd), 0)::text AS cost FROM ai_usage_events WHERE org_id = $1`,
        [input.orgId],
      ),
      client.query<{ balance: string }>(
        `SELECT COALESCE(sum(amount_usd), 0)::text AS balance FROM wallet_ledger WHERE org_id = $1`,
        [input.orgId],
      ),
    ]);
    const allowance = Number(entitlement.rows[0]?.includedAllowance ?? 0);
    const used = Number(models.rows[0]?.cost ?? 0);
    widgets.ai_usage = stamp("live", "ai_usage", {
      planCode: entitlement.rows[0]?.planCode ?? null,
      allowance,
      used,
      walletBalance: Number(wallet.rows[0]?.balance ?? 0),
      allowancePercent: allowance > 0 ? Math.min(100, (used / allowance) * 100) : null,
    });
  }

  async function notifications() {
    const rows = await client.query<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      createdAt: string;
      readAt: string | null;
    }>(
      `SELECT id, type, payload, created_at::text AS "createdAt", read_at::text AS "readAt"
       FROM notifications
       WHERE user_id = $1 AND (org_id IS NULL OR org_id = $2)
       ORDER BY created_at DESC
       LIMIT 8`,
      [input.userId, input.orgId],
    );
    widgets.notifications = stamp("live", "notifications", {
      items: rows.rows,
      unread: rows.rows.filter((item) => !item.readAt).length,
    });
  }

  async function robotReadiness() {
    const { loadBatteryFleet } = await import("../load-battery-fleet");
    const { batteryReadinessChecklist } = await import("../battery-reliability");
    const [due, fleet, failures] = await Promise.all([
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM maintenance_items
         WHERE org_id = $1 AND completed_at IS NULL AND (due_at IS NULL OR due_at <= now() + interval '2 days')`,
        [input.orgId],
      ),
      loadBatteryFleet(client, input.orgId),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM robot_failures
         WHERE org_id = $1 AND occurred_at > now() - interval '7 days'`,
        [input.orgId],
      ),
    ]);
    const dueCount = Number(due.rows[0]?.count ?? 0);
    const batteryCount = fleet.activeCount;
    const failureCount = Number(failures.rows[0]?.count ?? 0);
    const checklist = [
      ...batteryReadinessChecklist(fleet),
      { label: "Maintenance current", ready: dueCount === 0, detail: dueCount ? `${dueCount} due` : "Clear" },
      { label: "Recent failures", ready: failureCount === 0, detail: failureCount ? `${failureCount} in 7d` : "None" },
    ];
    const ready = checklist.filter((item) => item.ready).length;
    const percent = Math.round((ready / checklist.length) * 100);
    widgets.robot_readiness = stamp("live", "robot_readiness", {
      percent,
      checklist,
      dueCount,
      batteryCount,
      readyBatteries: fleet.readyCount,
      failureCount,
    });
  }

  async function alerts() {
    const [live, disagreements] = await Promise.all([
      client.query<{ id: string; severity: string; title: string; body: string; createdAt: string }>(
        `SELECT id, severity, title, body, created_at::text AS "createdAt"
         FROM org_live_alerts
         WHERE org_id = $1 AND acknowledged_at IS NULL
         ORDER BY created_at DESC
         LIMIT 5`,
        [input.orgId],
      ),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM scout_disagreements
         WHERE org_id = $1 AND status = 'open' AND ($2::text IS NULL OR event_key = $2)`,
        [input.orgId, eventKey],
      ),
    ]);
    widgets.alerts = stamp("live", "alerts", {
      items: live.rows,
      openDisagreements: Number(disagreements.rows[0]?.count ?? 0),
    });
  }

  async function teamTodos() {
    try {
      const [counts, items] = await Promise.all([
        client.query<{ todo: string; doing: string; mineOpen: string; overdue: string }>(
          `SELECT
             count(*) FILTER (WHERE status = 'todo')::text AS todo,
             count(*) FILTER (WHERE status = 'doing')::text AS doing,
             count(*) FILTER (
               WHERE status <> 'done' AND assignee_user_id = $2
             )::text AS "mineOpen",
             count(*) FILTER (
               WHERE status <> 'done' AND due_on IS NOT NULL AND due_on < CURRENT_DATE
             )::text AS overdue
           FROM team_todos
           WHERE org_id = $1`,
          [input.orgId, input.userId],
        ),
        client.query<{
          id: string;
          title: string;
          status: string;
          dueOn: string | null;
          assigneeName: string | null;
        }>(
          `SELECT
             t.id,
             t.title,
             t.status,
             t.due_on::text AS "dueOn",
             u.name AS "assigneeName"
           FROM team_todos t
           LEFT JOIN users u ON u.id = t.assignee_user_id
           WHERE t.org_id = $1 AND t.status <> 'done'
           ORDER BY
             CASE WHEN t.assignee_user_id = $2 THEN 0 ELSE 1 END,
             CASE t.status WHEN 'doing' THEN 0 ELSE 1 END,
             t.due_on NULLS LAST,
             t.created_at DESC
           LIMIT 5`,
          [input.orgId, input.userId],
        ),
      ]);
      const todo = Number(counts.rows[0]?.todo ?? 0);
      const doing = Number(counts.rows[0]?.doing ?? 0);
      const mineOpen = Number(counts.rows[0]?.mineOpen ?? 0);
      const overdue = Number(counts.rows[0]?.overdue ?? 0);
      const open = todo + doing;
      widgets.team_todos = stamp(open > 0 ? "live" : "empty", "team_todos", {
        todo,
        doing,
        open,
        mineOpen,
        overdue,
        items: items.rows,
      });
    } catch {
      widgets.team_todos = stamp(
        "setup_required",
        "team_todos",
        undefined,
        "Team todos need the latest database migration.",
      );
    }
  }

  async function subteamUpcoming() {
    const orgQuery = `?orgId=${encodeURIComponent(input.orgId)}`;
    try {
      const [subteamCount, mySubteams, events] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM team_subteams WHERE org_id = $1`,
          [input.orgId],
        ),
        client.query<{ id: string; name: string; color: string }>(
          `SELECT s.id, s.name, s.color
           FROM team_subteam_members m
           JOIN team_subteams s ON s.id = m.subteam_id
           WHERE m.org_id = $1 AND m.user_id = $2
           ORDER BY s.sort_order, lower(s.name)`,
          [input.orgId, input.userId],
        ),
        client.query<{
          id: string;
          title: string;
          kind: string;
          startsAt: string;
          subteamName: string | null;
          subteamColor: string | null;
        }>(
          `SELECT e.id, e.title, e.kind, e.starts_at::text AS "startsAt",
                  st.name AS "subteamName", st.color AS "subteamColor"
           FROM subteam_calendar_events e
           LEFT JOIN team_subteams st ON st.id = e.subteam_id
           WHERE e.org_id = $1
             AND e.starts_at >= now()
             AND (
               e.subteam_id IS NULL
               OR e.subteam_id IN (
                 SELECT subteam_id FROM team_subteam_members
                 WHERE org_id = $1 AND user_id = $2
               )
             )
           ORDER BY e.starts_at ASC
           LIMIT 5`,
          [input.orgId, input.userId],
        ),
      ]);
      const totalSubteams = Number(subteamCount.rows[0]?.count ?? 0);
      if (totalSubteams === 0) {
        widgets.subteam_upcoming = stamp(
          "setup_required",
          "subteam_upcoming",
          { href: `/team/calendar${orgQuery}`, ctaLabel: "Create first subteam" },
          "Create a subteam, then schedule your first practice.",
        );
        return;
      }
      if (events.rows.length === 0) {
        widgets.subteam_upcoming = stamp(
          "empty",
          "subteam_upcoming",
          {
            mySubteams: mySubteams.rows,
            href: `/team/calendar${orgQuery}`,
            ctaLabel: "Schedule first practice",
          },
          "Nothing upcoming for your subteams — schedule a practice on the team calendar.",
        );
        return;
      }
      widgets.subteam_upcoming = stamp("live", "subteam_upcoming", {
        items: events.rows,
        mySubteams: mySubteams.rows,
        href: `/team/calendar${orgQuery}`,
      });
    } catch {
      widgets.subteam_upcoming = stamp(
        "setup_required",
        "subteam_upcoming",
        { href: `/team/calendar${orgQuery}` },
        "Subteam calendars need the latest database migration.",
      );
    }
  }

  async function quickActions() {
    const orgQuery = `?orgId=${encodeURIComponent(input.orgId)}`;
    widgets.quick_actions = stamp("live", "quick_actions", {
      links: [
        { href: `/scouting${orgQuery}`, label: "Scout", detail: "Open assigned form" },
        { href: `/logistics${orgQuery}`, label: "Logistics", detail: "Lodging & travel checks" },
        { href: `/kickoff${orgQuery}`, label: "Kickoff", detail: "Scoring + design priorities" },
        { href: `/cad${orgQuery}`, label: "CAD brief", detail: "Design brief from team data" },
        { href: `/todos${orgQuery}`, label: "Todos", detail: "Your open team tasks" },
        { href: `/team/calendar${orgQuery}`, label: "Calendar", detail: "What's next for your subteam" },
      ],
    });
  }

  async function onboardingChecklist() {
    const orgQuery = `?orgId=${encodeURIComponent(input.orgId)}`;
    let joinedSubteam = false;
    let hasKnowledge = false;
    let hasLogistics = false;
    let kickoffReady = false;
    let openedCadBrief = false;

    try {
      const sub = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM team_subteam_members
         WHERE org_id = $1 AND user_id = $2`,
        [input.orgId, input.userId],
      );
      joinedSubteam = Number(sub.rows[0]?.count ?? 0) > 0;
    } catch {
      // stays false
    }

    try {
      const knowledge = await client.query<{ chars: string }>(
        `SELECT COALESCE(length(btrim(content)), 0)::text AS chars FROM team_knowledge WHERE org_id = $1`,
        [input.orgId],
      );
      hasKnowledge = Number(knowledge.rows[0]?.chars ?? 0) > 100;
    } catch {
      // stays false
    }

    try {
      const logistics = await client.query<{ trips: string; hotels: string }>(
        `SELECT
           (SELECT count(*)::text FROM logistics_trips WHERE org_id = $1) AS trips,
           (SELECT count(*)::text FROM logistics_hotels WHERE org_id = $1) AS hotels`,
        [input.orgId],
      );
      hasLogistics =
        Number(logistics.rows[0]?.trips ?? 0) > 0 || Number(logistics.rows[0]?.hotels ?? 0) > 0;
    } catch {
      // stays false
    }

    try {
      const year = new Date().getFullYear();
      const kick = await client.query<{ actions: string; priorities: string }>(
        `SELECT
           (SELECT count(*)::text FROM game_scoring_actions WHERE org_id = $1 AND season_year = $2) AS actions,
           (SELECT count(*)::text FROM design_priorities WHERE org_id = $1 AND season_year = $2) AS priorities`,
        [input.orgId, year],
      );
      kickoffReady =
        Number(kick.rows[0]?.actions ?? 0) > 0 || Number(kick.rows[0]?.priorities ?? 0) > 0;
    } catch {
      // stays false
    }

    try {
      const cad = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM cad_jobs
         WHERE org_id = $1 AND created_by = $2 AND kind = 'brief'`,
        [input.orgId, input.userId],
      );
      openedCadBrief = Number(cad.rows[0]?.count ?? 0) > 0;
    } catch {
      // cad_jobs schema may differ — treat as not done without inventing progress.
    }

    const knowsNextMatch = widgets.next_match?.status === "live";
    const steps = [
      ...buildOnboardingChecklistSteps({
        orgId: input.orgId,
        hasEventContext: Boolean(eventKey && teamKey),
        tbaConfigured,
        hasScoutingSchemas,
        hasAiProvider,
        joinedSubteam,
        hasKnowledge,
        hasLogistics,
        kickoffReady,
        knowsNextMatch,
      }),
      {
        key: "cad_brief",
        label: "Open CAD brief",
        detail: "Turn scouting + research into a design brief",
        done: openedCadBrief,
        href: `/cad${orgQuery}`,
      },
    ];
    const complete = steps.every((step) => step.done);
    widgets.onboarding_checklist = stamp(
      complete ? "live" : "setup_required",
      "onboarding_checklist",
      { steps, complete },
      complete ? undefined : "Complete the first-run checklist to unlock live widgets.",
    );
  }

  async function homeStrip() {
    const orgId = input.orgId;
    let needsAssignment = 0;
    let lodgingGaps = 0;
    let unsignedChecklists = 0;
    let visitHostGaps = 0;
    let nextPracticeTitle: string | null = null;
    let nextPracticeAt: string | null = null;
    let hotelName: string | null = null;
    let roomLabel: string | null = null;
    let nextTravelLabel: string | null = null;
    let nextTravelAt: string | null = null;
    let mineOpenTodos = 0;
    let kickoffReady = false;

    try {
      const duties = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM duty_assignments
         WHERE org_id = $1
           AND assigned_user_id IS NULL
           AND starts_at >= now()`,
        [orgId],
      );
      needsAssignment = Number(duties.rows[0]?.count ?? 0);
    } catch {
      // stays 0
    }

    try {
      const rooms = await client.query<{ occupantUserId: string | null; occupantName: string }>(
        `SELECT occupant_user_id AS "occupantUserId", occupant_name AS "occupantName"
         FROM logistics_room_assignments WHERE org_id = $1`,
        [orgId],
      );
      lodgingGaps = countLodgingGaps(rooms.rows);
      const mine = rooms.rows.find((room) => room.occupantUserId === input.userId);
      if (mine) {
        const hotel = await client.query<{ name: string; roomLabel: string }>(
          `SELECT h.name, r.room_label AS "roomLabel"
           FROM logistics_room_assignments r
           JOIN logistics_hotels h ON h.id = r.hotel_id
           WHERE r.org_id = $1 AND r.occupant_user_id = $2
           LIMIT 1`,
          [orgId, input.userId],
        );
        hotelName = hotel.rows[0]?.name ?? null;
        roomLabel = hotel.rows[0]?.roomLabel ?? null;
      }
    } catch {
      // stays 0
    }

    try {
      const unsigned = await client.query<{ count: string }>(
        `SELECT count(DISTINCT m.user_id)::text AS count
         FROM memberships m
         CROSS JOIN logistics_checklist_items i
         WHERE m.org_id = $1
           AND i.org_id = $1
           AND i.audience IN ('all', 'student', 'mentor')
           AND NOT EXISTS (
             SELECT 1 FROM logistics_checklist_checks c
             WHERE c.item_id = i.id AND c.user_id = m.user_id
           )`,
        [orgId],
      );
      unsignedChecklists = Number(unsigned.rows[0]?.count ?? 0);
    } catch {
      // stays 0
    }

    try {
      const practice = await client.query<{ title: string; startsAt: string }>(
        `SELECT e.title, e.starts_at::text AS "startsAt"
         FROM subteam_calendar_events e
         WHERE e.org_id = $1
           AND e.starts_at >= now()
           AND e.kind IN ('practice', 'build', 'meeting')
           AND (
             e.subteam_id IS NULL
             OR e.subteam_id IN (
               SELECT subteam_id FROM team_subteam_members
               WHERE org_id = $1 AND user_id = $2
             )
           )
         ORDER BY e.starts_at ASC
         LIMIT 1`,
        [orgId, input.userId],
      );
      nextPracticeTitle = practice.rows[0]?.title ?? null;
      nextPracticeAt = practice.rows[0]?.startsAt ?? null;
    } catch {
      // stay null
    }

    try {
      const todos = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM team_todos
         WHERE org_id = $1 AND assignee_user_id = $2 AND status <> 'done'`,
        [orgId, input.userId],
      );
      mineOpenTodos = Number(todos.rows[0]?.count ?? 0);
    } catch {
      // stays 0
    }

    try {
      const year = new Date().getFullYear();
      const kick = await client.query<{ actions: string; priorities: string }>(
        `SELECT
           (SELECT count(*)::text FROM game_scoring_actions WHERE org_id = $1 AND season_year = $2) AS actions,
           (SELECT count(*)::text FROM design_priorities WHERE org_id = $1 AND season_year = $2) AS priorities`,
        [orgId, year],
      );
      kickoffReady =
        Number(kick.rows[0]?.actions ?? 0) > 0 || Number(kick.rows[0]?.priorities ?? 0) > 0;
    } catch {
      // stays false
    }

    try {
      const travel = await client.query<{ title: string; startsAt: string }>(
        `SELECT title, starts_at::text AS "startsAt"
         FROM logistics_travel_legs
         WHERE org_id = $1 AND starts_at >= now()
         ORDER BY starts_at ASC
         LIMIT 1`,
        [orgId],
      );
      nextTravelLabel = travel.rows[0]?.title ?? null;
      nextTravelAt = travel.rows[0]?.startsAt ?? null;
    } catch {
      // stay null
    }

    try {
      const hosts = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM visit_invites v
         WHERE v.org_id = $1
           AND v.status IN ('draft', 'scheduled')
           AND NOT EXISTS (
             SELECT 1 FROM visit_invite_hosts h
             WHERE h.visit_id = v.id AND h.org_id = v.org_id
           )`,
        [orgId],
      );
      visitHostGaps = Number(hosts.rows[0]?.count ?? 0);
    } catch {
      // stays 0
    }

    context.homeStrip = {
      audience,
      items:
        audience === "mentor"
          ? buildMentorHomeStrip({
              orgId,
              needsAssignment,
              lodgingGaps,
              unsignedChecklists,
              visitHostGaps,
            })
          : buildStudentHomeStrip({
              orgId,
              nextPracticeTitle,
              nextPracticeAt,
              hotelName,
              roomLabel,
              nextTravelLabel,
              nextTravelAt,
              mineOpenTodos,
              kickoffReady,
            }),
    };
  }

  const jobs: Array<Promise<void>> = snapshotShouldLoadHomeStrip(input) ? [homeStrip()] : [];

  // The setup checklist consumes next-match state, so resolve that dependency
  // first only when the checklist was actually requested.
  if (wants("onboarding_checklist")) {
    await nextMatch();
    jobs.push(onboardingChecklist());
  } else if (wants("next_match")) {
    jobs.push(nextMatch());
  }

  const widgetLoaders: Array<[DashboardWidgetType, () => Promise<void>]> = [
    ["recent_result", recentResult],
    ["competition_snapshot", competitionSnapshot],
    ["scouting_coverage", scoutingCoverage],
    ["prediction_summary", predictionSummary],
    ["sync_status", syncStatus],
    ["pit_youtube", pitYoutube],
    ["ai_usage", aiUsage],
    ["notifications", notifications],
    ["robot_readiness", robotReadiness],
    ["alerts", alerts],
    ["team_todos", teamTodos],
    ["subteam_upcoming", subteamUpcoming],
    ["quick_actions", quickActions],
  ];
  for (const [type, load] of widgetLoaders) {
    if (wants(type)) jobs.push(load());
  }

  for (const type of HOME_WIDGET_TYPES) {
    if (wants(type)) {
      jobs.push(
        (async () => {
          widgets[type] = await loadHomeWidget(
            client,
            type,
            {
              orgId: input.orgId,
              userId: input.userId,
              eventKey,
              eventName: row.eventName,
              teamNumber: row.teamNumber,
              fundingModel: row.fundingModel,
            },
            stamp,
          );
        })(),
      );
    }
  }
  if (wants("ask_ai")) {
    jobs.push(
      (async () => {
        widgets.ask_ai = stamp("live", "ask_ai", { href: "/ai?tab=chat" }, "Ask a question.");
      })(),
    );
  }

  await Promise.all(jobs);

  return { context, widgets };
}
