/**
 * Scouting at a glance, for the Scouting home and its scouting-lead view.
 *
 * Pits first: a pit visit is the one report every team at the event needs, it can be done
 * before a single match is played, and it is what alliance partners ask about. Then match
 * coverage split the way a lead acts on it: robots in played matches nobody scouted are
 * lost, robots in upcoming matches with no scout are still fixable. Then each scout's own
 * numbers, so a returning scout sees what they have done and a lead sees who is missing.
 *
 * Every number is counted from rows that exist. Nothing is estimated, and a scout with no
 * reports shows zero, not a placeholder. Pure, so it is tested; the SQL is in
 * lead-summary-load.ts.
 */

import { detectMissedAssignments, isBackupRole, type AccountabilityAssignment } from "./assignment-accountability";

export type SummaryRosterTeam = { teamKey: string; teamNumber: number; nickname: string | null };
export type SummaryMatch = { matchKey: string; teamKeys: string[]; played: boolean };
export type SummaryEntry = { type: "match" | "pit"; matchKey: string | null; teamKey: string; scoutUserId: string; updatedAt: string };
export type SummaryMember = { userId: string; name: string; role: string };

export type ScoutStats = {
  userId: string;
  name: string;
  role: string;
  pitReports: number;
  matchReports: number;
  /** Assigned robots in played matches this scout did not file (backups only when every primary missed too). */
  missed: number;
  /** Robots still to come that are assigned to this scout. */
  upcoming: number;
  lastActiveAt: string | null;
};

export type LeadSummary = {
  pit: {
    /** Teams at the event other than your own. */
    total: number;
    visited: number;
    notVisited: SummaryRosterTeam[];
    /** Every other team, by number, with whether anyone on the team has a pit report for it. */
    teams: Array<SummaryRosterTeam & { visited: boolean }>;
    /**
     * Pit reports for teams that are not on the event's list (a typo, or a list that has not
     * caught up). Kept out of the total so one mistyped number cannot change the event.
     */
    otherVisited: SummaryRosterTeam[];
  };
  match: {
    playedMatches: number;
    playedRobots: number;
    playedScouted: number;
    playedMissed: number;
    upcomingRobots: number;
    /** Upcoming robots with no scout assigned and no report yet. */
    upcomingUnassigned: number;
    reports: number;
  };
  me: { pitReports: number; matchReports: number; missed: number; upcoming: number };
  scouts: ScoutStats[];
};

export function summarizeScouting(input: {
  roster: readonly SummaryRosterTeam[];
  ownTeamNumber: number | null;
  matches: readonly SummaryMatch[];
  entries: readonly SummaryEntry[];
  assignments: readonly AccountabilityAssignment[];
  members: readonly SummaryMember[];
  userId: string;
}): LeadSummary {
  const pitDone = new Set(input.entries.filter((entry) => entry.type === "pit").map((entry) => entry.teamKey));
  const others = input.roster
    .filter((team) => team.teamNumber !== input.ownTeamNumber)
    .sort((a, b) => a.teamNumber - b.teamNumber);
  const notVisited = others.filter((team) => !pitDone.has(team.teamKey));
  const onList = new Set(input.roster.map((team) => team.teamKey));
  const otherVisited = [...pitDone]
    .filter((teamKey) => !onList.has(teamKey) && /^frc\d+$/.test(teamKey))
    .map((teamKey) => ({ teamKey, teamNumber: Number(teamKey.slice(3)), nickname: null }))
    .filter((team) => team.teamNumber !== input.ownTeamNumber)
    .sort((a, b) => a.teamNumber - b.teamNumber);

  const matchEntries = input.entries.filter((entry) => entry.type === "match" && entry.matchKey);
  const scoutedRobots = new Set(matchEntries.map((entry) => `${entry.matchKey}|${entry.teamKey}`));
  const assignedRobots = new Set(
    input.assignments.filter((row) => !isBackupRole(row.role)).map((row) => `${row.matchKey}|${row.teamKey}`),
  );
  let playedMatches = 0;
  let playedRobots = 0;
  let playedScouted = 0;
  let upcomingRobots = 0;
  let upcomingUnassigned = 0;
  const playedKeys: string[] = [];
  const upcomingKeys = new Set<string>();
  for (const match of input.matches) {
    const robots = [...new Set(match.teamKeys.filter(Boolean))];
    if (match.played) {
      playedMatches++;
      playedKeys.push(match.matchKey);
      playedRobots += robots.length;
      playedScouted += robots.filter((team) => scoutedRobots.has(`${match.matchKey}|${team}`)).length;
    } else {
      upcomingKeys.add(match.matchKey);
      upcomingRobots += robots.length;
      upcomingUnassigned += robots.filter(
        (team) => !assignedRobots.has(`${match.matchKey}|${team}`) && !scoutedRobots.has(`${match.matchKey}|${team}`),
      ).length;
    }
  }

  const missed = detectMissedAssignments({
    assignments: input.assignments,
    entries: matchEntries.map((entry) => ({ matchKey: entry.matchKey!, teamKey: entry.teamKey, scoutUserId: entry.scoutUserId })),
    playedMatchKeys: playedKeys,
  });

  const stats = new Map<string, ScoutStats>();
  const statFor = (userId: string, name = "Team member", role = "member") => {
    let row = stats.get(userId);
    if (!row) {
      row = { userId, name, role, pitReports: 0, matchReports: 0, missed: 0, upcoming: 0, lastActiveAt: null };
      stats.set(userId, row);
    }
    return row;
  };
  for (const member of input.members) statFor(member.userId, member.name, member.role);
  for (const entry of input.entries) {
    const row = statFor(entry.scoutUserId);
    if (entry.type === "pit") row.pitReports++;
    else row.matchReports++;
    if (!row.lastActiveAt || entry.updatedAt > row.lastActiveAt) row.lastActiveAt = entry.updatedAt;
  }
  for (const miss of missed) statFor(miss.userId, miss.name).missed++;
  for (const assignment of input.assignments) {
    if (isBackupRole(assignment.role) || !upcomingKeys.has(assignment.matchKey)) continue;
    if (scoutedRobots.has(`${assignment.matchKey}|${assignment.teamKey}`)) continue;
    statFor(assignment.userId, assignment.name ?? undefined).upcoming++;
  }

  // Scouts who did something, or were given something, or are scouts by role. A mentor who
  // never scouted is not a gap on this list.
  const scouts = [...stats.values()]
    .filter((row) => row.pitReports + row.matchReports + row.missed + row.upcoming > 0 || row.role === "scout")
    .sort(
      (a, b) =>
        b.pitReports + b.matchReports - (a.pitReports + a.matchReports) ||
        b.missed - a.missed ||
        a.name.localeCompare(b.name),
    );
  const mine = stats.get(input.userId);

  return {
    pit: {
      total: others.length,
      visited: others.length - notVisited.length,
      notVisited,
      teams: others.map((team) => ({ ...team, visited: pitDone.has(team.teamKey) })),
      otherVisited,
    },
    match: {
      playedMatches,
      playedRobots,
      playedScouted,
      playedMissed: playedRobots - playedScouted,
      upcomingRobots,
      upcomingUnassigned,
      reports: matchEntries.length,
    },
    me: {
      pitReports: mine?.pitReports ?? 0,
      matchReports: mine?.matchReports ?? 0,
      missed: mine?.missed ?? 0,
      upcoming: mine?.upcoming ?? 0,
    },
    scouts,
  };
}

/** "3 of 24" style share, or null when there is nothing to divide by. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
