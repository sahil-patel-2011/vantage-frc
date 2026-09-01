// Display / pit-TV kiosk helpers. Never invent match/rank/prediction defaults.

import type { NexusQueueSnapshot } from "./command/nexus-queue";
import { isDemoPrediction, predictionWinDisplay } from "./strategy/prediction-display";

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

export type DisplayKioskMode = "kiosk" | "pit" | "stage";

const DISPLAY_MODE_PATHS: Record<DisplayKioskMode, string> = {
  kiosk: "/display/kiosk",
  pit: "/display/pit",
  stage: "/display/stage",
};

/**
 * Read-only TV URL for a minted display token. Pit mode is the Pi / 16:9 kiosk;
 * stage mode is the phase-aware board that auto-advances through the weekend.
 */
export function displayKioskHref(origin: string, token: string, mode: DisplayKioskMode = "kiosk"): string {
  const path = DISPLAY_MODE_PATHS[mode] ?? DISPLAY_MODE_PATHS.kiosk;
  return `${origin.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}

/** Chromium kiosk launch for a Raspberry Pi or similar pit TV stick. */
export function pitChromiumKioskCommand(url: string): string {
  return `chromium-browser --kiosk --noerrdialogs --disable-infobars --app=${url}`;
}

export const LEAVE_PIT_MS = 15 * 60_000;
/** PitFUSION-style: countdown goes red inside 5 minutes of TBA predicted/event time. */
export const QUEUE_SOON_MS = 5 * 60_000;

export type CountdownState = {
  label: string;
  remainingMs: number | null;
  leavePit: boolean;
  queueSoon: boolean;
  queueNow: boolean;
};

export function countdownState(scheduledTime: string | null | undefined, nowMs: number): CountdownState {
  if (!scheduledTime) return { label: "-", remainingMs: null, leavePit: false, queueSoon: false, queueNow: false };
  const target = new Date(scheduledTime).getTime();
  if (Number.isNaN(target)) return { label: "-", remainingMs: null, leavePit: false, queueSoon: false, queueNow: false };
  const remainingMs = target - nowMs;
  if (remainingMs <= 0) return { label: "QUEUE NOW", remainingMs, leavePit: true, queueSoon: true, queueNow: true };
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  return {
    label: `${minutes}:${String(seconds).padStart(2, "0")}`,
    remainingMs,
    leavePit: remainingMs <= LEAVE_PIT_MS,
    queueSoon: remainingMs <= QUEUE_SOON_MS,
    queueNow: false,
  };
}

export function queueCue(clock: CountdownState): string {
  if (clock.queueNow) return "QUEUE NOW";
  if (clock.queueSoon) return "QUEUE SOON";
  if (clock.leavePit) return "LEAVE PIT NOW";
  return "STAY READY";
}

/** Our bumper color from the TBA alliance lists — never guessed. */
export function ourBumperColor(
  match: Pick<DisplayNextMatch, "redAlliance" | "blueAlliance"> | null | undefined,
  teamNumber: number | null | undefined,
): "red" | "blue" | null {
  if (!match || teamNumber == null || !Number.isFinite(teamNumber)) return null;
  const needle = String(teamNumber);
  const on = (keys: string[] | undefined) => (keys ?? []).some((key) => stripFrc(key) === needle);
  if (on(match.redAlliance?.teamKeys)) return "red";
  if (on(match.blueAlliance?.teamKeys)) return "blue";
  return null;
}

export function bumperBanner(color: "red" | "blue" | null): string {
  if (color === "red") return "RED bumpers";
  if (color === "blue") return "BLUE bumpers";
  return "Bumper color unknown";
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

/** True only when scouting rows exist — hides zero tiles that look like DEMO coverage. */
export function hasScoutingCoverageSignal(scouting: DisplayScouting | null | undefined): boolean {
  if (!scouting) return false;
  return scouting.assignments > 0 || scouting.reports > 0 || scouting.openDisagreements > 0;
}

/** True when Event Command has at least one real match, rank/record, or scout alert. */
export function hasEventCommandSignal(
  snapshot: Pick<DisplaySnapshot, "nextMatch" | "eventStatus" | "scouting">,
): boolean {
  if (snapshot.nextMatch) return true;
  if (snapshot.eventStatus?.rank != null) return true;
  if (snapshot.eventStatus?.wins != null || snapshot.eventStatus?.losses != null) return true;
  return snapshot.scouting.openDisagreements > 0;
}

export function formatDisplayPrediction(prediction: DisplayPrediction | null | undefined): string {
  if (!prediction) return "No stored prediction";
  if (
    isDemoPrediction({
      modelVersion: prediction.modelVersion,
      pRed: prediction.pRed,
      pBlue: prediction.pBlue,
      caveats: prediction.caveats,
    })
  ) {
    return "No grounded prediction";
  }
  const red = predictionWinDisplay({
    pRed: prediction.pRed,
    alliance: "red",
    modelVersion: prediction.modelVersion,
    caveats: prediction.caveats,
  });
  const blue = predictionWinDisplay({
    pBlue: prediction.pBlue,
    alliance: "blue",
    modelVersion: prediction.modelVersion,
    caveats: prediction.caveats,
  });
  if (!red || !blue) return "No grounded prediction";
  return `${red.label} red · ${blue.label} blue`;
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
      return formatDisplayPrediction(snapshot.prediction);
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
      AND COALESCE(p.model_version, '') !~* 'demo'
      AND COALESCE(p.caveats::text, '') !~* 'demo'
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
      'batteriesActive', (SELECT count(*)::int FROM battery_packs bat WHERE bat.org_id = o.id AND bat.status = 'active'),
      'batteriesService', (SELECT count(*)::int FROM battery_packs bat WHERE bat.org_id = o.id AND bat.status = 'quarantine'),
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

/* ================================================================== *
 * PIT DISPLAY V2 — phase-aware screens for the competition weekend.
 *
 * The board rotates through screens that match where the event actually is:
 * pre-event -> quals -> alliance selection -> playoffs -> post-event. Every
 * phase is derived from SYNCED match rows, never from the calendar alone, and
 * every screen renders only the rows that exist. A team with no sponsors gets
 * no sponsor scroll; an event with no ranking rows gets no ranking table.
 * ================================================================== */

export const DISPLAY_PHASES = [
  "pre_event",
  "quals",
  "alliance_selection",
  "playoffs",
  "post_event",
] as const;

export type DisplayPhase = (typeof DISPLAY_PHASES)[number];

export type DisplayProgress = {
  qualsTotal: number;
  qualsPlayed: number;
  playoffTotal: number;
  playoffPlayed: number;
};

export type DisplayRankingRow = {
  teamKey: string;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  source: string | null;
};

export type DisplayScheduleRow = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
  redAlliance: { teamKeys: string[] };
  blueAlliance: { teamKeys: string[] };
};

export type DisplayPlayoffRow = {
  matchKey: string;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  scheduledTime: string | null;
  redAlliance: { teamKeys: string[] };
  blueAlliance: { teamKeys: string[] };
  winningAlliance: string | null;
};

export type DisplaySponsorRow = { name: string; tier: string | null };

export type DisplayStageNexus = {
  live: unknown;
  pits: Record<string, string> | null;
  map: unknown;
  syncedAt: string | null;
};

export type DisplayStageSnapshot = {
  board: { id?: string; name: string; preset: string };
  organization: { name: string; teamNumber: number };
  activeEvent: {
    eventKey: string | null;
    name: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  progress: DisplayProgress | null;
  schedule: DisplayScheduleRow[];
  rankings: DisplayRankingRow[];
  eventStatus: DisplayEventStatus | null;
  playoffMatches: DisplayPlayoffRow[];
  sponsors: DisplaySponsorRow[];
  nexus: DisplayStageNexus | null;
  updatedAt: string;
};

/**
 * Where the event is, from synced rows only.
 *
 * Alliance selection is the gap we can actually observe: every qual has been
 * played and no playoff match has been posted yet. We never guess it from a
 * clock. With no synced matches at all the answer is pre-event — a display
 * showing "quals" for an event nobody has synced would be a lie.
 */
export function displayPhase(input: {
  progress: DisplayProgress | null | undefined;
  playoffCount?: number;
}): DisplayPhase {
  const p = input.progress;
  if (!p || p.qualsTotal <= 0) {
    // A bracket without quals (offseason/playoff-only) still counts as playoffs.
    if (p && p.playoffTotal > 0) {
      return p.playoffPlayed >= p.playoffTotal ? "post_event" : "playoffs";
    }
    return "pre_event";
  }
  if (p.playoffTotal > 0 && p.playoffPlayed >= p.playoffTotal) return "post_event";
  if (p.playoffTotal > 0) return "playoffs";
  if (p.qualsPlayed >= p.qualsTotal) return "alliance_selection";
  if (p.qualsPlayed > 0) return "quals";
  return "pre_event";
}

export const DISPLAY_STAGE_SCREENS = [
  "schedule",
  "pit_map",
  "queue",
  "next_match",
  "rankings",
  "alliance_selection",
  "bracket",
  "results",
  "thanks",
] as const;

export type DisplayStageScreen = (typeof DISPLAY_STAGE_SCREENS)[number];

/** The rotation for each phase, in order. */
export const DISPLAY_PHASE_SCREENS: Record<DisplayPhase, DisplayStageScreen[]> = {
  pre_event: ["schedule", "pit_map"],
  quals: ["queue", "next_match", "rankings"],
  alliance_selection: ["alliance_selection", "rankings"],
  playoffs: ["bracket", "queue", "next_match"],
  post_event: ["thanks", "results"],
};

export const DISPLAY_PHASE_LABELS: Record<DisplayPhase, string> = {
  pre_event: "Before the event",
  quals: "Qualification matches",
  alliance_selection: "Alliance selection",
  playoffs: "Playoffs",
  post_event: "Event complete",
};

/** How long each screen holds before the board auto-advances. */
export const DISPLAY_SCREEN_HOLD_MS = 20_000;

/** The screen to show at a given tick. Always returns a screen in the phase. */
export function stageScreenAt(phase: DisplayPhase, tick: number): DisplayStageScreen {
  const screens = DISPLAY_PHASE_SCREENS[phase];
  if (!screens.length) return "schedule";
  const index = ((Math.trunc(tick) % screens.length) + screens.length) % screens.length;
  // noUncheckedIndexedAccess: the modulo above keeps `index` in range, but the
  // fallback keeps the return type honest rather than asserting non-null.
  return screens[index] ?? screens[0] ?? "schedule";
}

/** 10-foot type toggle. 1 is the design size; the rest scale the whole board. */
export const DISPLAY_FONT_SCALES = [0.85, 1, 1.25, 1.5] as const;
export type DisplayFontScale = (typeof DISPLAY_FONT_SCALES)[number];

export function nextFontScale(current: number): DisplayFontScale {
  const index = DISPLAY_FONT_SCALES.findIndex((scale) => scale === current);
  return DISPLAY_FONT_SCALES[(index + 1) % DISPLAY_FONT_SCALES.length] ?? 1;
}

export function fontScaleLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Sponsor thank-you marquee text. Empty array in -> empty string out, no filler. */
export function sponsorScrollText(sponsors: DisplaySponsorRow[] | null | undefined): string {
  const names = (sponsors ?? []).map((sponsor) => sponsor.name.trim()).filter(Boolean);
  if (!names.length) return "";
  return `THANK YOU TO OUR SPONSORS · ${names.join(" · ")}`;
}

/** Playoff rows grouped into bracket rounds, preserving the synced order. */
export function bracketRounds(
  matches: DisplayPlayoffRow[] | null | undefined,
): Array<{ compLevel: string; matches: DisplayPlayoffRow[] }> {
  const rounds: Array<{ compLevel: string; matches: DisplayPlayoffRow[] }> = [];
  for (const match of matches ?? []) {
    const last = rounds[rounds.length - 1];
    if (last && last.compLevel === match.compLevel) last.matches.push(match);
    else rounds.push({ compLevel: match.compLevel, matches: [match] });
  }
  return rounds;
}

/** True only when the phase's screens have real rows behind them. */
export function stageScreenHasContent(
  screen: DisplayStageScreen,
  snapshot: Pick<
    DisplayStageSnapshot,
    "schedule" | "rankings" | "playoffMatches" | "sponsors" | "nexus" | "eventStatus"
  >,
): boolean {
  switch (screen) {
    case "schedule":
    case "next_match":
      return snapshot.schedule.length > 0;
    case "rankings":
    case "alliance_selection":
      return snapshot.rankings.length > 0;
    case "bracket":
    case "results":
      return snapshot.playoffMatches.length > 0;
    case "queue":
      return Boolean(snapshot.nexus?.live);
    case "pit_map":
      return Boolean(snapshot.nexus?.map) || Boolean(snapshot.nexus?.pits);
    case "thanks":
      return snapshot.sponsors.length > 0 || snapshot.eventStatus != null;
    default:
      return false;
  }
}

/**
 * The rotation actually shown: the phase's screens minus the ones with no rows.
 * When nothing in the phase has content the board shows a single honest empty
 * screen rather than cycling through blanks.
 */
export function stageRotation(
  phase: DisplayPhase,
  snapshot: Pick<
    DisplayStageSnapshot,
    "schedule" | "rankings" | "playoffMatches" | "sponsors" | "nexus" | "eventStatus"
  >,
): DisplayStageScreen[] {
  return DISPLAY_PHASE_SCREENS[phase].filter((screen) => stageScreenHasContent(screen, snapshot));
}

/** SQL mirror of get_display_stage() for signed-in (orgId + boardId) previews. */
export const DISPLAY_STAGE_SELECT = `
SELECT jsonb_build_object(
  'board', jsonb_build_object('id', b.id, 'name', b.name, 'preset', b.preset),
  'organization', jsonb_build_object('name', o.name, 'teamNumber', o.team_number),
  'activeEvent', jsonb_build_object(
    'eventKey', c.active_event_key, 'name', e.name,
    'startDate', e.start_date, 'endDate', e.end_date
  ),
  'progress', (
    SELECT jsonb_build_object(
      'qualsTotal', count(*) FILTER (WHERE m.comp_level = 'qm')::int,
      'qualsPlayed', count(*) FILTER (WHERE m.comp_level = 'qm' AND m.actual_time IS NOT NULL)::int,
      'playoffTotal', count(*) FILTER (WHERE m.comp_level <> 'qm')::int,
      'playoffPlayed', count(*) FILTER (WHERE m.comp_level <> 'qm' AND m.actual_time IS NOT NULL)::int
    )
    FROM matches_ref m WHERE m.event_key = c.active_event_key
  ),
  'schedule', (
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."scheduledTime"), '[]'::jsonb)
    FROM (
      SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
             COALESCE(m.predicted_time, m.event_time) AS "scheduledTime",
             m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
      FROM matches_ref m
      WHERE m.event_key = c.active_event_key
        AND (
          m.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
          OR m.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
        )
        AND COALESCE(m.actual_time, m.predicted_time, m.event_time) > now()
      ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
      LIMIT 6
    ) s
  ),
  'rankings', (
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.rank), '[]'::jsonb)
    FROM (
      SELECT * FROM (
        SELECT DISTINCT ON (tem.team_key)
          tem.team_key AS "teamKey", tem.rank, tem.wins, tem.losses, tem.ties, tem.source
        FROM team_event_metrics tem
        WHERE tem.event_key = c.active_event_key AND tem.rank IS NOT NULL
        ORDER BY tem.team_key,
          CASE tem.source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END,
          tem.synced_at DESC
      ) ranked
      ORDER BY ranked.rank
      LIMIT 12
    ) r
  ),
  'eventStatus', (
    SELECT jsonb_build_object('rank', tem.rank, 'wins', tem.wins, 'losses', tem.losses,
                              'ties', tem.ties, 'source', tem.source)
    FROM team_event_metrics tem
    WHERE tem.event_key = c.active_event_key AND tem.team_key = ('frc' || o.team_number::text)
    ORDER BY CASE tem.source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END, tem.synced_at DESC
    LIMIT 1
  ),
  'playoffMatches', (
    SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p."compLevel", p."setNumber", p."matchNumber"), '[]'::jsonb)
    FROM (
      SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.set_number AS "setNumber",
             m.match_number AS "matchNumber", m.red_alliance AS "redAlliance",
             m.blue_alliance AS "blueAlliance", m.winning_alliance AS "winningAlliance",
             COALESCE(m.predicted_time, m.event_time) AS "scheduledTime"
      FROM matches_ref m
      WHERE m.event_key = c.active_event_key AND m.comp_level <> 'qm'
      ORDER BY m.comp_level, m.set_number, m.match_number
      LIMIT 32
    ) p
  ),
  'sponsors', (
    SELECT COALESCE(jsonb_agg(to_jsonb(sp) ORDER BY sp.name), '[]'::jsonb)
    FROM (
      SELECT s.name, s.tier::text AS tier
      FROM sponsors s
      WHERE s.org_id = o.id AND s.status = 'active'
      ORDER BY s.name
      LIMIT 60
    ) sp
  ),
  'nexus', (
    SELECT jsonb_build_object('live', ns.live, 'pits', ns.pits, 'map', ns.map, 'syncedAt', ns.synced_at)
    FROM nexus_event_snapshots ns WHERE ns.event_key = c.active_event_key
  ),
  'updatedAt', now()
) AS stage
FROM display_boards b
JOIN organizations o ON o.id = b.org_id
LEFT JOIN org_active_context c ON c.org_id = o.id
LEFT JOIN events_ref e ON e.event_key = c.active_event_key
`;

/* ================================================================== *
 * NEXUS VENUE MAP — the real pit hall, drawn from `GET /event/{key}/map`.
 *
 * The geometry shapes are described structurally rather than imported from
 * @vantage/reference so this module stays runtime-free and safe to pull into a
 * client bundle. `buildVenueMap` returns null whenever there is nothing real to
 * draw: the caller then falls back to the team's own pit-footprint planner
 * instead of rendering an invented venue.
 * ================================================================== */

export type VenueMapShapeInput = {
  id: string | null;
  label: string | null;
  teamNumber: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type VenueMapGeometryInput = {
  width: number | null;
  height: number | null;
  pits: VenueMapShapeInput[];
  areas: VenueMapShapeInput[];
};

export type VenueMapShape = VenueMapShapeInput & {
  kind: "pit" | "area";
  /** True only when Nexus attributed this pit to our team number. */
  ours: boolean;
  /** True only when a Nexus parts request names this pit's team. */
  requester: boolean;
};

export type VenueMapView = {
  /** SVG viewBox covering every drawable shape, with a small margin. */
  viewBox: string;
  width: number;
  height: number;
  shapes: VenueMapShape[];
  ourShape: VenueMapShape | null;
  requesterCount: number;
};

/** Margin (in map units) kept around the geometry so strokes are not clipped. */
const VENUE_MAP_MARGIN = 8;

/**
 * Fold Nexus venue geometry into a drawable view.
 *
 * `teamNumber` marks our pit; `requesterTeams` marks the pits of teams that
 * posted a parts request, so "a team near you needs…" has somewhere to point.
 * Neither marker is guessed — a team Nexus never placed simply is not marked.
 */
export function buildVenueMap(input: {
  map: VenueMapGeometryInput | null | undefined;
  teamNumber?: number | string | null;
  requesterTeams?: Array<string | null> | null;
}): VenueMapView | null {
  const map = input.map;
  if (!map) return null;
  const ourTeam = input.teamNumber != null ? String(input.teamNumber).trim() : "";
  const requesters = new Set(
    (input.requesterTeams ?? []).filter((team): team is string => Boolean(team && team.trim())).map((team) => team.trim()),
  );

  const shapes: VenueMapShape[] = [
    ...map.areas.map((shape) => ({ ...shape, kind: "area" as const, ours: false, requester: false })),
    ...map.pits.map((shape) => ({
      ...shape,
      kind: "pit" as const,
      ours: Boolean(ourTeam) && shape.teamNumber === ourTeam,
      requester: Boolean(shape.teamNumber) && requesters.has(shape.teamNumber!),
    })),
  ];
  if (!shapes.length) return null;

  // Prefer the venue's own canvas size; fall back to the bounds of what we got.
  const maxX = Math.max(...shapes.map((shape) => shape.x + shape.width));
  const maxY = Math.max(...shapes.map((shape) => shape.y + shape.height));
  const minX = Math.min(...shapes.map((shape) => shape.x));
  const minY = Math.min(...shapes.map((shape) => shape.y));
  const width = map.width && map.width > 0 ? map.width : maxX - Math.min(0, minX);
  const height = map.height && map.height > 0 ? map.height : maxY - Math.min(0, minY);
  const originX = Math.min(0, minX) - VENUE_MAP_MARGIN;
  const originY = Math.min(0, minY) - VENUE_MAP_MARGIN;

  return {
    viewBox: `${originX} ${originY} ${width + VENUE_MAP_MARGIN * 2} ${height + VENUE_MAP_MARGIN * 2}`,
    width,
    height,
    shapes,
    ourShape: shapes.find((shape) => shape.ours) ?? null,
    requesterCount: shapes.filter((shape) => shape.requester).length,
  };
}

/** What to print inside a pit box. Team number wins; otherwise the Nexus label. */
export function venueShapeLabel(shape: VenueMapShape): string {
  return shape.teamNumber ?? shape.label ?? "";
}

/**
 * What `GET /api/display/stage` returns: the board snapshot plus the two views
 * derived from the cached Nexus payload on the server, so the TV never has to
 * parse a Nexus body itself. Both derived fields are null when Nexus posted
 * nothing — the board then shows the screens it does have rows for.
 */
export type DisplayStagePayload = DisplayStageSnapshot & {
  queue: NexusQueueSnapshot | null;
  venueMap: VenueMapView | null;
};

/**
 * What `GET /api/nexus/venue-map` returns for the Pit Map Planner.
 * `setup_required` carries the real reason (no active event / no cached Nexus
 * payload / no geometry) so the planner can say it instead of drawing a
 * stand-in venue.
 */
export type NexusVenueMapView =
  | {
      status: "setup_required";
      message: string;
      attributionHref: string;
    }
  | {
      status: "live";
      eventKey: string;
      eventName: string | null;
      map: VenueMapView;
      ourPitAddress: string | null;
      requests: Array<{ team: string | null; parts: string; pitAddress: string | null }>;
      syncedAt: string | null;
      attributionHref: string;
    };
