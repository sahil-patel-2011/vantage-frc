import type { PoolClient } from "@neondatabase/serverless";
import { platformTbaEnvConfigured } from "@vantage/reference";
import { canAccessWidget, type DashboardWidgetType } from "./catalog";

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
  input: { orgId: string; userId: string; role: string | null },
): Promise<{ context: Record<string, unknown>; widgets: Record<string, WidgetPayload> }> {
  const org = await client.query<{
    name: string;
    teamNumber: number | null;
    eventKey: string | null;
    eventName: string | null;
  }>(
    `SELECT o.name, o.team_number AS "teamNumber", c.active_event_key AS "eventKey", e.name AS "eventName"
     FROM organizations o
     LEFT JOIN org_active_context c ON c.org_id = o.id
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE o.id = $1`,
    [input.orgId],
  );
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
  const tbaMeta = await client.query<{ credential: boolean; cache: boolean }>(
    `SELECT
       EXISTS(
         SELECT 1 FROM data_source_credentials
         WHERE source = 'tba' AND disabled_at IS NULL
           AND (org_id IS NULL OR org_id = $1)
       ) AS credential,
       EXISTS(
         SELECT 1 FROM matches_ref LIMIT 1
       ) OR EXISTS(
         SELECT 1 FROM team_event_metrics LIMIT 1
       ) AS cache`,
    [input.orgId],
  );
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

  const context = {
    orgName: row.name,
    teamNumber: row.teamNumber,
    eventKey,
    eventName: row.eventName,
    role: input.role,
    setupRequired: !eventKey || !teamKey,
    tbaConfigured,
    hasScoutingSchemas,
    hasAiProvider,
  };

  const widgets: Record<string, WidgetPayload> = {};

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
    widgets.next_match = stamp("live", "next_match", match.rows[0] as unknown as Record<string, unknown>);
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
    if (!eventKey || !teamKey) {
      widgets.competition_snapshot = stamp(
        "setup_required",
        "competition_snapshot",
        undefined,
        "Select an active event and team workspace.",
      );
      return;
    }
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
    if (!metrics.rows[0]) {
      widgets.competition_snapshot = stamp(
        "empty",
        "competition_snapshot",
        undefined,
        "Reference metrics not synced for this team/event yet.",
      );
      return;
    }
    const m = metrics.rows[0];
    widgets.competition_snapshot = stamp("live", "competition_snapshot", {
      ...m,
      record: `${m.wins ?? 0}-${m.losses ?? 0}-${m.ties ?? 0}`,
    });
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
    const prediction = await client.query<{
      matchKey: string;
      pRed: number;
      pBlue: number;
      confidenceLow: number;
      confidenceHigh: number;
      modelVersion: string;
      keyFactors: unknown;
      scoredAt: string;
    }>(
      `SELECT p.match_key AS "matchKey", p.p_red AS "pRed", p.p_blue AS "pBlue",
              p.confidence_low AS "confidenceLow", p.confidence_high AS "confidenceHigh",
              p.model_version AS "modelVersion", p.key_factors AS "keyFactors", p.scored_at::text AS "scoredAt"
       FROM predictions p
       JOIN matches_ref m ON m.match_key = p.match_key
       WHERE p.org_id = $1 AND m.event_key = $2
       ORDER BY p.scored_at DESC
       LIMIT 1`,
      [input.orgId, eventKey],
    );
    if (!prediction.rows[0]) {
      widgets.prediction_summary = stamp("empty", "prediction_summary", undefined, "No stored predictions for this event yet.");
      return;
    }
    widgets.prediction_summary = stamp("live", "prediction_summary", prediction.rows[0] as unknown as Record<string, unknown>);
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
    const [due, batteries, failures] = await Promise.all([
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM maintenance_items
         WHERE org_id = $1 AND completed_at IS NULL AND (due_at IS NULL OR due_at <= now() + interval '2 days')`,
        [input.orgId],
      ),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM batteries WHERE org_id = $1 AND status = 'active'`,
        [input.orgId],
      ),
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM robot_failures
         WHERE org_id = $1 AND occurred_at > now() - interval '7 days'`,
        [input.orgId],
      ),
    ]);
    const dueCount = Number(due.rows[0]?.count ?? 0);
    const batteryCount = Number(batteries.rows[0]?.count ?? 0);
    const failureCount = Number(failures.rows[0]?.count ?? 0);
    const checklist = [
      { label: "Active batteries tracked", ready: batteryCount > 0, detail: batteryCount ? `${batteryCount} active` : "None logged" },
      { label: "Maintenance current", ready: dueCount === 0, detail: dueCount ? `${dueCount} due` : "Clear" },
      { label: "Recent failures", ready: failureCount === 0, detail: failureCount ? `${failureCount} in 7d` : "None" },
    ];
    const ready = checklist.filter((item) => item.ready).length;
    const percent = Math.round((ready / checklist.length) * 100);
    widgets.robot_readiness = stamp("live", "robot_readiness", { percent, checklist, dueCount, batteryCount, failureCount });
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

  async function quickActions() {
    const orgQuery = `?orgId=${encodeURIComponent(input.orgId)}`;
    widgets.quick_actions = stamp("live", "quick_actions", {
      links: [
        { href: `/scouting${orgQuery}`, label: "Scout", detail: "Open assigned form" },
        { href: `/pit${orgQuery}`, label: "Pit Command", detail: "Release gate & battery" },
        { href: `/strategy${orgQuery}`, label: "Strategize", detail: "Run match what-if" },
        { href: `/business${orgQuery}`, label: "Business", detail: "Budget, sponsors & grants" },
        { href: `/messages${orgQuery}`, label: "Messages", detail: "Team chat & DMs" },
      ],
    });
  }

  async function onboardingChecklist() {
    const orgQuery = `?orgId=${encodeURIComponent(input.orgId)}`;
    const steps = [
      {
        key: "workspace",
        label: "Join workspace",
        detail: "Accept a team invite or select your org",
        done: true,
        href: "/invite",
      },
      {
        key: "event",
        label: "Select event",
        detail: "Set the active competition context",
        done: Boolean(eventKey && teamKey),
        href: `/command${orgQuery}`,
      },
      {
        key: "tba",
        label: "Sync TBA",
        detail: "Connect match and rank ingest",
        done: tbaConfigured,
        href: `/team/data${orgQuery}`,
      },
      {
        key: "scouting",
        label: "Scout",
        detail: "Starter match and pit forms",
        done: hasScoutingSchemas,
        href: `/scouting${orgQuery}`,
      },
      {
        key: "ai",
        label: "Metered AI",
        detail: "BYO provider for free-tier AI",
        done: hasAiProvider,
        href: `/team${orgQuery}#custom-providers`,
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

  await Promise.all([
    onboardingChecklist(),
    nextMatch(),
    recentResult(),
    competitionSnapshot(),
    scoutingCoverage(),
    predictionSummary(),
    syncStatus(),
    pitYoutube(),
    aiUsage(),
    notifications(),
    robotReadiness(),
    alerts(),
    quickActions(),
  ]);

  return { context, widgets };
}
