// Display / pit-TV kiosk helpers. Never invent match/rank/prediction defaults.

export const DISPLAY_PRESETS = [
  "next_match",
  "win_prediction",
  "robot_readiness",
  "event_command",
  "scouting_coverage",
  "custom",
] as const;

export type DisplayPreset = (typeof DISPLAY_PRESETS)[number];

export const DISPLAY_WIDGET_TYPES = [
  "next_match",
  "prediction",
  "strategy",
  "robot_readiness",
  "event_status",
  "scouting_coverage",
  "alerts",
  "team_intel",
] as const;

export type DisplayWidgetType = (typeof DISPLAY_WIDGET_TYPES)[number];

export type DisplayWidget = {
  type: DisplayWidgetType | string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export type DisplayNextMatch = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
  redAlliance: { teamKeys: string[] };
  blueAlliance: { teamKeys: string[] };
};

export type DisplayPrediction = {
  matchKey: string;
  pRed: number;
  pBlue: number;
  confidenceLow: number;
  confidenceHigh: number;
  modelVersion: string;
  keyFactors: Array<{ name: string; impact: number; evidence?: string }>;
  caveats: string[];
  scoredAt: string | null;
};

export type DisplayEventStatus = {
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  source: string | null;
};

export type DisplayReadiness = {
  batteriesActive: number;
  batteriesService: number;
  openFailures: number;
  openMaintenance: number;
};

export type DisplayScouting = {
  assignments: number;
  reports: number;
  openDisagreements: number;
};

export type DisplaySnapshot = {
  board: { id?: string; name: string; preset: string; widgets: DisplayWidget[] };
  organization: { name: string; teamNumber: number };
  activeEvent: { eventKey?: string | null; name: string | null };
  nextMatch: DisplayNextMatch | null;
  prediction: DisplayPrediction | null;
  eventStatus: DisplayEventStatus | null;
  readiness: DisplayReadiness | null;
  scouting: DisplayScouting;
  strategyHeadline: string | null;
  updatedAt: string;
};

export const PRESET_WIDGETS: Record<string, DisplayWidgetType[]> = {
  next_match: ["next_match", "alerts"],
  win_prediction: ["prediction", "strategy"],
  robot_readiness: ["robot_readiness", "alerts"],
  event_command: ["event_status", "next_match", "alerts"],
  scouting_coverage: ["scouting_coverage", "team_intel"],
};

export const PRESET_META: Array<{ id: DisplayPreset; title: string; copy: string }> = [
  { id: "next_match", title: "Next Match", copy: "Countdown, alliances, scheduled time, and leave-now status from TBA" },
  { id: "win_prediction", title: "Win Prediction", copy: "Stored Strategy model odds - empty until you score a match prediction" },
  { id: "robot_readiness", title: "Robot Readiness", copy: "Battery fleet, open failures, and maintenance from Pit ops - never assumed green" },
  { id: "event_command", title: "Event Command", copy: "Next team match plus TBA rank/record when metrics are synced" },
  { id: "scouting_coverage", title: "Scouting Coverage", copy: "Assignments, reports, and open disagreements at the active event" },
  { id: "custom", title: "Custom grid", copy: "Pick authorized competition-readable widgets only" },
];

const LEVEL_LABELS: Record<string, string> = { qm: "Qual", qf: "QF", sf: "SF", f: "Final" };

export function stripFrc(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

export function formatAlliance(keys: string[] | undefined | null): string {
  if (!keys?.length) return "-";
  return keys.map(stripFrc).join(" · ");
}

export function matchLabel(compLevel: string, matchNumber: number): string {
  return `${LEVEL_LABELS[compLevel] ?? compLevel.toUpperCase()} ${matchNumber}`;
}

export function isDisplayPreset(value: string): value is DisplayPreset {
  return (DISPLAY_PRESETS as readonly string[]).includes(value);
}

export function isDisplayWidgetType(value: string): value is DisplayWidgetType {
  return (DISPLAY_WIDGET_TYPES as readonly string[]).includes(value);
}

export const LEAVE_PIT_MS = 15 * 60_000;

export type CountdownState = {
  label: string;
  remainingMs: number | null;
  leavePit: boolean;
  queueNow: boolean;
};

export function countdownState(scheduledTime: string | null | undefined, nowMs: number): CountdownState {
  if (!scheduledTime) return { label: "-", remainingMs: null, leavePit: false, queueNow: false };
  const target = new Date(scheduledTime).getTime();
  if (Number.isNaN(target)) return { label: "-", remainingMs: null, leavePit: false, queueNow: false };
  const remainingMs = target - nowMs;
  if (remainingMs <= 0) return { label: "QUEUE NOW", remainingMs, leavePit: true, queueNow: true };
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  return {
    label: `${minutes}:${String(seconds).padStart(2, "0")}`,
    remainingMs,
    leavePit: remainingMs <= LEAVE_PIT_MS,
    queueNow: false,
  };
}

export function recordLabel(status: DisplayEventStatus | null): string {
  if (!status || (status.wins == null && status.losses == null)) return "-";
  const w = status.wins ?? 0;
  const l = status.losses ?? 0;
  const t = status.ties ?? 0;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export function rankLabel(status: DisplayEventStatus | null): string {
  if (!status?.rank) return "-";
  return `#${status.rank}`;
}

export function hasReadinessSignal(readiness: DisplayReadiness | null): boolean {
  if (!readiness) return false;
  return (
    readiness.batteriesActive > 0 ||
    readiness.batteriesService > 0 ||
    readiness.openFailures > 0 ||
    readiness.openMaintenance > 0
  );
}

export function widgetValue(
  type: string,
  snapshot: Pick<DisplaySnapshot, "nextMatch" | "prediction" | "scouting" | "eventStatus" | "readiness" | "strategyHeadline">,
): string {
  switch (type) {
    case "next_match":
      return snapshot.nextMatch
        ? matchLabel(snapshot.nextMatch.compLevel, snapshot.nextMatch.matchNumber)
        : "No upcoming team match";
    case "prediction":
      return snapshot.prediction
        ? `${Math.round(snapshot.prediction.pRed * 100)}% red · ${Math.round(snapshot.prediction.pBlue * 100)}% blue`
        : "No stored prediction";
    case "strategy":
      return snapshot.strategyHeadline?.trim() || "No strategy headline";
    case "robot_readiness":
      return hasReadinessSignal(snapshot.readiness)
        ? `${snapshot.readiness!.batteriesActive} active packs · ${snapshot.readiness!.openFailures} open failures`
        : "No readiness data yet";
    case "event_status":
      return snapshot.eventStatus
        ? `${rankLabel(snapshot.eventStatus)} · ${recordLabel(snapshot.eventStatus)}`
        : "Rank not synced";
    case "scouting_coverage":
      return `${snapshot.scouting.reports} reports · ${snapshot.scouting.assignments} assignments`;
    case "alerts":
      return snapshot.scouting.openDisagreements > 0
        ? `${snapshot.scouting.openDisagreements} open scout disagreements`
        : "No open scout disagreements";
    case "team_intel":
      return snapshot.eventStatus?.source ? `Metrics via ${snapshot.eventStatus.source}` : "Awaiting event metrics";
    default:
      return "Unauthorized or unknown widget";
  }
}

export const DISPLAY_SNAPSHOT_SELECT = `
SELECT jsonb_build_object(
  'board', jsonb_build_object('id', b.id, 'name', b.name, 'preset', b.preset, 'widgets', b.widgets),
  'organization', jsonb_build_object('name', o.name, 'teamNumber', o.team_number),
  'activeEvent', jsonb_build_object('eventKey', c.active_event_key, 'name', e.name),
  'nextMatch', (
    SELECT jsonb_build_object(
      'matchKey', m.match_key, 'compLevel', m.comp_level, 'matchNumber', m.match_number,
      'scheduledTime', COALESCE(m.predicted_time, m.event_time),
      'redAlliance', m.red_alliance, 'blueAlliance', m.blue_alliance
    )
    FROM matches_ref m
    WHERE m.event_key = c.active_event_key
      AND (
        m.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
        OR m.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
      )
      AND COALESCE(m.actual_time, m.predicted_time, m.event_time) > now()
    ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
    LIMIT 1
  ),
  'prediction', (
    SELECT jsonb_build_object(
      'matchKey', p.match_key, 'pRed', p.p_red, 'pBlue', p.p_blue,
      'confidenceLow', p.confidence_low, 'confidenceHigh', p.confidence_high,
      'modelVersion', p.model_version, 'keyFactors', p.key_factors, 'caveats', p.caveats, 'scoredAt', p.scored_at
    )
    FROM predictions p
    JOIN matches_ref m ON m.match_key = p.match_key
    WHERE p.org_id = o.id AND m.event_key = c.active_event_key
    ORDER BY
      CASE WHEN p.match_key = (
        SELECT m2.match_key FROM matches_ref m2
        WHERE m2.event_key = c.active_event_key
          AND (
            m2.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
            OR m2.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
          )
          AND COALESCE(m2.actual_time, m2.predicted_time, m2.event_time) > now()
        ORDER BY COALESCE(m2.actual_time, m2.predicted_time, m2.event_time)
        LIMIT 1
      ) THEN 0 ELSE 1 END,
      p.scored_at DESC
    LIMIT 1
  ),
  'eventStatus', (
    SELECT jsonb_build_object('rank', tem.rank, 'wins', tem.wins, 'losses', tem.losses, 'ties', tem.ties, 'source', tem.source)
    FROM team_event_metrics tem
    WHERE tem.event_key = c.active_event_key AND tem.team_key = ('frc' || o.team_number::text)
    ORDER BY CASE tem.source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END, tem.synced_at DESC
    LIMIT 1
  ),
  'readiness', jsonb_build_object(
    'batteriesActive', (SELECT count(*)::int FROM batteries bat WHERE bat.org_id = o.id AND bat.status = 'active'),
    'batteriesService', (SELECT count(*)::int FROM batteries bat WHERE bat.org_id = o.id AND bat.status = 'service'),
    'openFailures', (
      SELECT count(*)::int FROM robot_failures rf
      WHERE rf.org_id = o.id AND rf.resolution IS NULL
        AND (c.active_event_key IS NULL OR rf.event_key IS NULL OR rf.event_key = c.active_event_key)
    ),
    'openMaintenance', (SELECT count(*)::int FROM maintenance_items mi WHERE mi.org_id = o.id AND mi.completed_at IS NULL)
  ),
  'scouting', jsonb_build_object(
    'assignments', (SELECT count(*)::int FROM scout_assignments a WHERE a.org_id = o.id AND a.event_key = c.active_event_key),
    'reports', (SELECT count(*)::int FROM match_scout_entries s WHERE s.org_id = o.id AND s.event_key = c.active_event_key),
    'openDisagreements', (
      SELECT count(*)::int FROM scout_disagreements d
      WHERE d.org_id = o.id AND d.event_key = c.active_event_key AND d.status = 'open'
    )
  ),
  'strategyHeadline', (
    SELECT COALESCE(sp.content->>'title', sp.name)
    FROM strategy_playbooks sp WHERE sp.org_id = o.id
    ORDER BY sp.updated_at DESC NULLS LAST, sp.created_at DESC LIMIT 1
  ),
  'updatedAt', now()
) AS snapshot
FROM display_boards b
JOIN organizations o ON o.id = b.org_id
LEFT JOIN org_active_context c ON c.org_id = o.id
LEFT JOIN events_ref e ON e.event_key = c.active_event_key
`;
