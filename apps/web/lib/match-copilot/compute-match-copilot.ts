import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import {
  allianceTeamKeys,
  batteryHealth,
  composeMatchCopilotCallouts,
  teamKeyForNumber,
} from ".";
import type {
  MatchCopilotAlliance,
  MatchCopilotBattery,
  MatchCopilotCallout,
  MatchCopilotRisk,
  MatchCopilotSetupStep,
  MatchCopilotTeam,
  MatchCopilotView,
} from "./types";

export type { MatchCopilotView } from "./types";

export const MATCH_COPILOT_FEATURE = "match_copilot.brief";

function setupRequired(message: string, steps: MatchCopilotSetupStep[], orgId: string | null): MatchCopilotView {
  return { status: "setup_required", message, steps, orgId };
}

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO match metrics. */
function setupStepsFor(orgId: string | null, focus: "workspace" | "team" | "event" | "schedule"): MatchCopilotSetupStep[] {
  const workspace: MatchCopilotSetupStep = {
    id: "workspace",
    label: "Choose your team",
    detail: "Choose your team to open Match Copilot.",
    href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
  };
  const team: MatchCopilotSetupStep = {
    id: "team",
    label: "Confirm team number",
    detail: "Your team number powers match filtering.",
    href: withOrgHref("/team", orgId),
  };
  const command: MatchCopilotSetupStep = {
    id: "command",
    label: "Set active event",
    detail: "Choose the competition you are at today.",
    href: hubHref("/competition", "command", orgId),
  };
  const strategy: MatchCopilotSetupStep = {
    id: "strategy",
    label: "Open Strategy",
    detail: "Match plans stay empty until real metrics exist.",
    href: hubHref("/competition", "strategy", orgId),
  };
  const schedule: MatchCopilotSetupStep = {
    id: "schedule",
    label: "Sync event schedule",
    detail: "Confirm TBA sync has the qualification/playoff schedule loaded.",
    href: withOrgHref("/team/data", orgId),
  };
  const fmea: MatchCopilotSetupStep = {
    id: "fmea",
    label: "Open FMEA",
    detail: "Risk callouts stay blank until real open failures exist.",
    href: hubHref("/team", "fmea", orgId),
  };

  if (focus === "workspace") return [workspace, strategy, command, fmea];
  if (focus === "team") return [team, command, strategy, fmea];
  if (focus === "event") return [command, strategy, fmea, workspace];
  return [schedule, command, strategy, fmea];
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

type ActiveEventRow = { eventKey: string | null; eventName: string | null; seasonYear: number | null };

async function resolveActiveEvent(client: PoolClient, orgId: string): Promise<ActiveEventRow> {
  const result = await client.query<ActiveEventRow>(
    `SELECT c.active_event_key AS "eventKey", e.name AS "eventName", e.year AS "seasonYear"
     FROM org_active_context c
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE c.org_id = $1`,
    [orgId],
  );
  return result.rows[0] ?? { eventKey: null, eventName: null, seasonYear: null };
}

type NextMatchRow = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
  redAlliance: unknown;
  blueAlliance: unknown;
};

async function resolveNextMatch(
  client: PoolClient,
  eventKey: string,
  teamKey: string,
): Promise<NextMatchRow | null> {
  const result = await client.query<NextMatchRow>(
    `SELECT match_key AS "matchKey", comp_level AS "compLevel", match_number AS "matchNumber",
            COALESCE(predicted_time, event_time)::text AS "scheduledTime",
            red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
     FROM matches_ref
     WHERE event_key = $1
       AND (red_alliance->'teamKeys' ? $2 OR blue_alliance->'teamKeys' ? $2)
       AND actual_time IS NULL
     ORDER BY COALESCE(predicted_time, event_time) ASC NULLS LAST, comp_level, match_number
     LIMIT 1`,
    [eventKey, teamKey],
  );
  return result.rows[0] ?? null;
}

type MetricRow = {
  teamKey: string;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  rank: number | null;
};

/** Exported for the consolidated Pre-Match Briefing (lib/briefing). */
export async function loadTeams(
  client: PoolClient,
  eventKey: string,
  teamKeys: string[],
): Promise<Map<string, MatchCopilotTeam>> {
  if (!teamKeys.length) return new Map();

  const [metricsResult, refResult] = await Promise.all([
    client.query<MetricRow>(
      `SELECT DISTINCT ON (team_key) team_key AS "teamKey",
              epa_total AS "epaTotal", epa_auto AS "epaAuto",
              epa_teleop AS "epaTeleop", epa_endgame AS "epaEndgame", rank
       FROM team_event_metrics
       WHERE event_key = $1 AND team_key = ANY($2::text[])
       ORDER BY team_key, CASE source WHEN 'statbotics' THEN 0 ELSE 1 END`,
      [eventKey, teamKeys],
    ),
    client.query<{ teamKey: string; teamNumber: number; nickname: string | null }>(
      `SELECT team_key AS "teamKey", team_number AS "teamNumber", nickname
       FROM teams_ref WHERE team_key = ANY($1::text[])`,
      [teamKeys],
    ),
  ]);

  const metricsByKey = new Map(metricsResult.rows.map((row) => [row.teamKey, row]));
  const refByKey = new Map(refResult.rows.map((row) => [row.teamKey, row]));
  const teams = new Map<string, MatchCopilotTeam>();
  for (const teamKey of teamKeys) {
    const metric = metricsByKey.get(teamKey);
    const ref = refByKey.get(teamKey);
    const numberFromKey = Number(/^frc(\d+)$/.exec(teamKey)?.[1] ?? NaN);
    teams.set(teamKey, {
      teamKey,
      teamNumber: ref?.teamNumber ?? (Number.isFinite(numberFromKey) ? numberFromKey : 0),
      nickname: ref?.nickname ?? null,
      epaTotal: metric?.epaTotal ?? null,
      epaAuto: metric?.epaAuto ?? null,
      epaTeleop: metric?.epaTeleop ?? null,
      epaEndgame: metric?.epaEndgame ?? null,
      rank: metric?.rank ?? null,
    });
  }
  return teams;
}

function summarizePlan(plan: unknown): string | null {
  if (!plan || typeof plan !== "object") return null;
  const parts: string[] = [];
  const record = plan as Record<string, unknown>;
  const playbook = record.playbook;
  if (playbook && typeof playbook === "object") {
    const name = (playbook as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) parts.push(`Playbook: ${name.trim()}`);
  }
  const matchup = record.matchup;
  if (Array.isArray(matchup)) {
    const considerations = matchup.filter((item): item is string => typeof item === "string").slice(0, 3);
    if (considerations.length) parts.push(considerations.join(" "));
  }
  const tendencies = record.tendencies;
  if (typeof tendencies === "string" && tendencies.trim()) parts.push(tendencies.trim());
  return parts.length ? parts.join(" ") : null;
}

async function loadStrategyPlan(
  client: PoolClient,
  orgId: string,
  matchKey: string,
  alliance: MatchCopilotAlliance,
): Promise<{ hasPlan: boolean; summary: string | null }> {
  const result = await client.query<{ plan: unknown }>(
    `SELECT plan FROM match_strategies
     WHERE org_id = $1 AND match_key = $2 AND alliance = $3
     ORDER BY created_at DESC LIMIT 1`,
    [orgId, matchKey, alliance],
  );
  const row = result.rows[0];
  if (!row) return { hasPlan: false, summary: null };
  return { hasPlan: true, summary: summarizePlan(row.plan) };
}

/** Exported for the consolidated Pre-Match Briefing (lib/briefing). */
export async function loadOpenRisks(client: PoolClient, orgId: string, seasonYear: number): Promise<MatchCopilotRisk[]> {
  const result = await client.query<{
    id: string;
    subsystemName: string;
    title: string;
    occurrence: number;
    severity: number;
    detection: number;
    status: string;
  }>(
    `SELECT id, subsystem_name AS "subsystemName", title, occurrence, severity, detection, status
     FROM fmea_failures
     WHERE org_id = $1 AND season_year = $2 AND status IN ('open', 'fixing')
     ORDER BY (occurrence * severity * detection) DESC, occurred_at DESC
     LIMIT 8`,
    [orgId, seasonYear],
  );
  return result.rows.map((row) => ({
    id: row.id,
    subsystemName: row.subsystemName,
    title: row.title,
    occurrence: row.occurrence,
    severity: row.severity,
    detection: row.detection,
    rpn: row.occurrence * row.severity * row.detection,
    status: row.status,
  }));
}

/** Exported for the consolidated Pre-Match Briefing (lib/briefing). */
export async function loadBatteryFleet(client: PoolClient, orgId: string): Promise<MatchCopilotBattery[]> {
  const result = await client.query<{
    id: string;
    label: string;
    status: string;
    restingVoltage: number | null;
    resistanceMilliohms: number | null;
  }>(
    `SELECT p.id, p.label, p.status,
            latest.resting_voltage AS "restingVoltage",
            latest.internal_resistance_mohm AS "resistanceMilliohms"
     FROM battery_packs p
     LEFT JOIN LATERAL (
       SELECT l.resting_voltage, l.internal_resistance_mohm
       FROM battery_logs l
       WHERE l.battery_id = p.id AND l.org_id = p.org_id
         AND (l.resting_voltage IS NOT NULL OR l.internal_resistance_mohm IS NOT NULL)
       ORDER BY l.created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE p.org_id = $1
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'quarantine' THEN 1 ELSE 2 END, p.label
     LIMIT 50`,
    [orgId],
  );
  return result.rows.map((row) => {
    const restingVoltage = row.restingVoltage == null ? null : Number(row.restingVoltage);
    const resistanceMilliohms = row.resistanceMilliohms == null ? null : Number(row.resistanceMilliohms);
    const health = batteryHealth({ restingVoltage, resistanceMilliohms });
    return {
      id: row.id,
      label: row.label,
      status: row.status,
      restingVoltage,
      resistanceMilliohms,
      healthScore: health.healthScore,
      flag: health.flag,
    };
  });
}

/** Exported for the consolidated Pre-Match Briefing (lib/briefing). */
export async function loadLatestBrief(
  client: PoolClient,
  orgId: string,
  matchKey: string,
): Promise<{ callouts: MatchCopilotCallout[]; generatedBy: "ai" | "local" } | null> {
  const result = await client.query<{ callouts: MatchCopilotCallout[]; generatedBy: "ai" | "local" }>(
    `SELECT callouts, generated_by AS "generatedBy"
     FROM match_copilot_briefs
     WHERE org_id = $1 AND match_key = $2
     ORDER BY created_at DESC LIMIT 1`,
    [orgId, matchKey],
  );
  const row = result.rows[0];
  return row ? { callouts: row.callouts ?? [], generatedBy: row.generatedBy } : null;
}

export type MatchCopilotContext = {
  orgId: string;
  teamNumber: number;
  eventKey: string;
  eventName: string | null;
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
  alliance: MatchCopilotAlliance;
  opponents: MatchCopilotTeam[];
  allies: MatchCopilotTeam[];
  ourEpaTotal: number | null;
  hasStrategyPlan: boolean;
  strategySummary: string | null;
  openRisks: MatchCopilotRisk[];
  batteryFleet: MatchCopilotBattery[];
};

async function buildContext(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<{ context: MatchCopilotContext } | { setup: MatchCopilotView }> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      setup: setupRequired(
        "Choose your team to open Match Copilot.",
        setupStepsFor(null, "workspace"),
        null,
      ),
    };
  }
  if (!org.teamNumber) {
    return {
      setup: setupRequired(
        "Set your organization's team number so Match Copilot can find your next match.",
        setupStepsFor(org.orgId, "team"),
        org.orgId,
      ),
    };
  }

  const activeEvent = await resolveActiveEvent(client, org.orgId);
  if (!activeEvent.eventKey || !activeEvent.seasonYear) {
    return {
      setup: setupRequired(
        "Set your active event so Match Copilot can find your next match.",
        setupStepsFor(org.orgId, "event"),
        org.orgId,
      ),
    };
  }

  const teamKey = teamKeyForNumber(org.teamNumber);
  const match = await resolveNextMatch(client, activeEvent.eventKey, teamKey);
  if (!match) {
    return {
      setup: setupRequired(
        "No upcoming match found for your team at the active event yet.",
        setupStepsFor(org.orgId, "schedule"),
        org.orgId,
      ),
    };
  }

  const redKeys = allianceTeamKeys(match.redAlliance);
  const blueKeys = allianceTeamKeys(match.blueAlliance);
  const alliance: MatchCopilotAlliance = redKeys.includes(teamKey) ? "red" : "blue";
  const opponentKeys = (alliance === "red" ? blueKeys : redKeys).filter((key) => key !== teamKey);
  const allyKeys = (alliance === "red" ? redKeys : blueKeys).filter((key) => key !== teamKey);

  const teamsByKey = await loadTeams(client, activeEvent.eventKey, [teamKey, ...opponentKeys, ...allyKeys]);
  const opponents = opponentKeys.map((key) => teamsByKey.get(key)).filter((t): t is MatchCopilotTeam => Boolean(t));
  const allies = allyKeys.map((key) => teamsByKey.get(key)).filter((t): t is MatchCopilotTeam => Boolean(t));
  const ourEpaTotal = teamsByKey.get(teamKey)?.epaTotal ?? null;

  const [strategyPlan, openRisks, batteryFleet] = await Promise.all([
    loadStrategyPlan(client, org.orgId, match.matchKey, alliance),
    loadOpenRisks(client, org.orgId, activeEvent.seasonYear),
    loadBatteryFleet(client, org.orgId),
  ]);

  return {
    context: {
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      eventKey: activeEvent.eventKey,
      eventName: activeEvent.eventName,
      matchKey: match.matchKey,
      compLevel: match.compLevel,
      matchNumber: match.matchNumber,
      scheduledTime: match.scheduledTime,
      alliance,
      opponents,
      allies,
      ourEpaTotal,
      hasStrategyPlan: strategyPlan.hasPlan,
      strategySummary: strategyPlan.summary,
      openRisks,
      batteryFleet,
    },
  };
}

/** Read-only view: reuses the latest persisted brief if one exists, otherwise
 * shows a locally composed preview (never metered — metering happens only on
 * explicit "generate-brief" requests). */
export async function computeMatchCopilotView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MatchCopilotView> {
  const built = await buildContext(client, input);
  if ("setup" in built) return built.setup;
  const { context } = built;

  const persisted = await loadLatestBrief(client, context.orgId, context.matchKey);
  const callouts =
    persisted?.callouts ??
    composeMatchCopilotCallouts({
      alliance: context.alliance,
      opponents: context.opponents,
      ourEpaTotal: context.ourEpaTotal,
      hasStrategyPlan: context.hasStrategyPlan,
      strategySummary: context.strategySummary,
      openRisks: context.openRisks,
      batteryFleet: context.batteryFleet,
    });

  return {
    status: "live",
    orgId: context.orgId,
    teamNumber: context.teamNumber,
    eventKey: context.eventKey,
    eventName: context.eventName,
    matchKey: context.matchKey,
    compLevel: context.compLevel,
    matchNumber: context.matchNumber,
    scheduledTime: context.scheduledTime,
    alliance: context.alliance,
    opponents: context.opponents,
    allies: context.allies,
    ourEpaTotal: context.ourEpaTotal,
    hasStrategyPlan: context.hasStrategyPlan,
    strategySummary: context.strategySummary,
    openRisks: context.openRisks,
    batteryFleet: context.batteryFleet,
    callouts,
    generatedBy: persisted?.generatedBy ?? "local",
    computedAt: new Date().toISOString(),
  };
}

/** Metered generation: routes the deterministic fusion through meteredAI (so
 * usage is ledgered like every other AI-metered feature) and persists the
 * resulting brief for replay. */
export async function generateMatchCopilotBrief(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MatchCopilotView> {
  const built = await buildContext(client, input);
  if ("setup" in built) return built.setup;
  const { context } = built;

  const requestId = `match-copilot-${randomUUID()}`;
  const callouts = await meteredAI<MatchCopilotCallout[]>({
    client,
    orgId: context.orgId,
    userId: input.userId,
    feature: MATCH_COPILOT_FEATURE,
    requestId,
    estimatedCostUsd: 0,
    provider: "local",
    model: "vantage-match-copilot-v1",
    keySource: "local_cli",
    metadata: { matchKey: context.matchKey, alliance: context.alliance },
    invoke: async () => {
      const value = composeMatchCopilotCallouts({
        alliance: context.alliance,
        opponents: context.opponents,
        ourEpaTotal: context.ourEpaTotal,
        hasStrategyPlan: context.hasStrategyPlan,
        strategySummary: context.strategySummary,
        openRisks: context.openRisks,
        batteryFleet: context.batteryFleet,
      });
      const text = JSON.stringify(value);
      return {
        value,
        promptTokens: Math.ceil(text.length / 4),
        completionTokens: Math.ceil(text.length / 4),
        costUsd: 0,
        model: "vantage-match-copilot-v1",
        provider: "local",
      };
    },
  });

  await client.query(
    `INSERT INTO match_copilot_briefs (org_id, match_key, alliance, callouts, generated_by, created_by)
     VALUES ($1, $2, $3, $4::jsonb, 'local', $5)`,
    [context.orgId, context.matchKey, context.alliance, JSON.stringify(callouts), input.userId],
  );

  return {
    status: "live",
    orgId: context.orgId,
    teamNumber: context.teamNumber,
    eventKey: context.eventKey,
    eventName: context.eventName,
    matchKey: context.matchKey,
    compLevel: context.compLevel,
    matchNumber: context.matchNumber,
    scheduledTime: context.scheduledTime,
    alliance: context.alliance,
    opponents: context.opponents,
    allies: context.allies,
    ourEpaTotal: context.ourEpaTotal,
    hasStrategyPlan: context.hasStrategyPlan,
    strategySummary: context.strategySummary,
    openRisks: context.openRisks,
    batteryFleet: context.batteryFleet,
    callouts,
    generatedBy: "local",
    computedAt: new Date().toISOString(),
  };
}
