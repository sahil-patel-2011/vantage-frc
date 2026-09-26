// Match Schedule Board — framework-free domain logic shared by the API route,
// the client UI, and unit tests. No server or React imports belong here.

import type { TimelineRobot, TimelineVideo } from "./schedule/match-timeline";

export type ScheduleMatchPrediction = {
  redPredicted: number;
  bluePredicted: number;
  redWinPct: number | null;
  blueWinPct: number | null;
};

export type ScheduleMatch = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  /** COALESCE(actual_time, predicted_time, event_time) as text, or null. */
  scheduledTime: string | null;
  red: string[];
  blue: string[];
  redScore: number | null;
  blueScore: number | null;
  winningAlliance: "red" | "blue" | null;
  scoutCount: number;
  /** Upcoming-match estimate from real event ratings. Null when any robot is missing. */
  prediction?: ScheduleMatchPrediction | null;
  // ---- Timeline detail (optional: older cached payloads and other callers omit it) ----
  /** Playoff set number (SF2-1 → 2). */
  setNumber?: number | null;
  /** TBA published slot (`time`). */
  plannedTime?: string | null;
  /** TBA live estimate (`predicted_time`). */
  predictedTime?: string | null;
  /** When the field actually ran it. */
  actualTime?: string | null;
  /** When the result was posted. */
  postResultTime?: string | null;
  /** Six robots with who is assigned and how many entries came in. */
  robots?: TimelineRobot[];
  /** Match notes (match-notes-timeline) filed against this match key. */
  noteCount?: number;
  /** A team-indexed video link, else TBA's official upload, else null. */
  video?: TimelineVideo | null;
};

export type ScheduleContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  eventKey: string | null;
  eventName: string | null;
  /** The signed-in member, so "my assignments" can filter without a second request. */
  viewerUserId?: string | null;
};

export type ScheduleView =
  | { status: "ready"; context: ScheduleContext; matches: ScheduleMatch[] }
  | { status: "setup_required"; context: ScheduleContext; message: string };

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

const LEVEL_LABELS: Record<string, string> = {
  qm: "Qual",
  qf: "QF",
  sf: "SF",
  f: "Final",
};

/** Human label for a TBA comp level: qm→Qual, qf→QF, sf→SF, f→Final, else uppercased. */
export function compLevelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level.toUpperCase();
}

/** Which alliance contains the team, or null when it is not in the match. */
export function allianceOf(match: ScheduleMatch, teamKey: string): "red" | "blue" | null {
  if (match.red.includes(teamKey)) return "red";
  if (match.blue.includes(teamKey)) return "blue";
  return null;
}

/** True once both alliance scores are recorded. */
export function isScored(match: ScheduleMatch): boolean {
  return match.redScore != null && match.blueScore != null;
}

/** "frc1678" → "1678" for compact display. */
export function stripFrc(teamKey: string): string {
  return teamKey.startsWith("frc") ? teamKey.slice(3) : teamKey;
}

export type MatchOutcome = { result: "W" | "L" | "T"; us: number; opp: number };

/** Result from our team's perspective; null when unscored or the team is absent. */
export function matchResult(match: ScheduleMatch, teamKey: string): MatchOutcome | null {
  const side = allianceOf(match, teamKey);
  if (!side || match.redScore == null || match.blueScore == null) return null;
  const us = side === "red" ? match.redScore : match.blueScore;
  const opp = side === "red" ? match.blueScore : match.redScore;
  return { result: us === opp ? "T" : us > opp ? "W" : "L", us, opp };
}

/** Matches featuring the team, preserving schedule order. */
export function ourMatches(matches: ScheduleMatch[], teamKey: string): ScheduleMatch[] {
  return matches.filter((match) => allianceOf(match, teamKey) != null);
}

const LATE_MATCH_GRACE_MS = 3 * 60 * 60 * 1000;

function hasStarted(match: ScheduleMatch): boolean {
  return isScored(match) || match.winningAlliance != null || Boolean(match.actualTime);
}

/**
 * "This match is still to come" — the rule in matches/match-ahead-sql.ts, for a schedule already
 * loaded in memory. A match is over once it has a result or a start time, once any later
 * qualification match in the list has one (the field moved past it), or once its time is more
 * than three hours gone. Anything else is still ahead, late or not.
 *
 * It used to be "its time is still in the future": while Qual 31 ran late, Event day said
 * "Qual 31 · BLUE bumpers" and Schedule and My Day said "Qual 32 · RED" at the same moment.
 */
export function isMatchStillAhead(match: ScheduleMatch, matches: ScheduleMatch[], now: number = Date.now()): boolean {
  if (hasStarted(match)) return false;
  const when = match.predictedTime ?? match.plannedTime ?? match.scheduledTime;
  if (when) {
    const time = new Date(when).getTime();
    if (!Number.isNaN(time) && time <= now - LATE_MATCH_GRACE_MS) return false;
  }
  if (match.compLevel === "qm") {
    const fieldMovedOn = matches.some(
      (other) => other.compLevel === "qm" && other.matchNumber > match.matchNumber && hasStarted(other),
    );
    if (fieldMovedOn) return false;
  }
  return true;
}

/** First match containing the team that is still to come (see isMatchStillAhead), in schedule order. */
export function nextOurMatch(matches: ScheduleMatch[], teamKey: string, now: number = Date.now()): ScheduleMatch | null {
  for (const match of matches) {
    if (allianceOf(match, teamKey) == null) continue;
    if (isMatchStillAhead(match, matches, now)) return match;
  }
  return null;
}

/** Count of unscored matches strictly before the target in schedule order. */
export function matchesUntil(matches: ScheduleMatch[], target: ScheduleMatch): number {
  let count = 0;
  for (const match of matches) {
    if (match.matchKey === target.matchKey) break;
    if (!isScored(match)) count += 1;
  }
  return count;
}

export type ScheduleLevelGroup = { level: string; label: string; matches: ScheduleMatch[] };

/** Group by comp level, preserving schedule order and first-seen level order. */
export function splitByLevel(matches: ScheduleMatch[]): ScheduleLevelGroup[] {
  const groups: ScheduleLevelGroup[] = [];
  const byLevel = new Map<string, ScheduleLevelGroup>();
  for (const match of matches) {
    let group = byLevel.get(match.compLevel);
    if (!group) {
      group = { level: match.compLevel, label: compLevelLabel(match.compLevel), matches: [] };
      byLevel.set(match.compLevel, group);
      groups.push(group);
    }
    group.matches.push(match);
  }
  return groups;
}

/** "" for null/unparsable, else e.g. "Sat 9:41 AM" in the viewer's locale. */
export function fmtMatchTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
