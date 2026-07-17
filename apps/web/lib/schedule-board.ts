// Match Schedule Board — framework-free domain logic shared by the API route,
// the client UI, and unit tests. No server or React imports belong here.

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
};

export type ScheduleContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  eventKey: string | null;
  eventName: string | null;
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

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * First match containing the team that has no scores yet and is not stale
 * (scheduled time missing, unparsable, or newer than six hours ago).
 */
export function nextOurMatch(matches: ScheduleMatch[], teamKey: string, now: number = Date.now()): ScheduleMatch | null {
  for (const match of matches) {
    if (allianceOf(match, teamKey) == null) continue;
    if (isScored(match)) continue;
    if (match.scheduledTime != null) {
      const time = new Date(match.scheduledTime).getTime();
      if (!Number.isNaN(time) && time < now - SIX_HOURS_MS) continue;
    }
    return match;
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
