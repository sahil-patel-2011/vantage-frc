// One robot, match by match.
//
// The team profile answers "how good is this robot on average". A pick-list
// meeting then asks the follow-ups: was that 70 against good opponents, did it
// fall off after lunch, is it better with a defender beside it. Those need the
// matches themselves — who it played with and against, what the field said,
// what our scouts saw, and the clip.
//
// Two kinds of number sit side by side here and never mix:
//   - observed: what our scouts recorded (match_scout_entries), turned into
//     points by the team's own value formula when one exists;
//   - official: what TBA posted for the whole alliance (matches_ref).
// The UI labels them that way. Nothing is estimated to fill a gap.
//
// Pure — the loader hands it rows; tests call it directly.

import { isScoutIdentityField } from "@vantage/scouting/identity";
import { allianceScore, allianceTeamKeys, type TbaAllianceJson } from "../schedule/tba-cache";
import { safeVideoUrl, shortMatchLabel, tbaVideoUrl } from "../schedule/match-timeline";
import { matchRowTotal, onePerMatch, scoutedRowsFromEntries, type OrgValueFormula } from "./scouted-ratings";
import { matchOrderKey } from "./next-assignment";

export type TeamLogEntryRow = {
  matchKey: string;
  payload: Record<string, unknown> | null;
};

export type TeamLogMatchRow = {
  matchKey: string;
  compLevel: string;
  setNumber: number | null;
  matchNumber: number;
  redAlliance: TbaAllianceJson;
  blueAlliance: TbaAllianceJson;
  winningAlliance: string | null;
  time: string | null;
  tbaVideoType?: string | null;
  tbaVideoKey?: string | null;
};

export type TeamLogNoteRow = { matchKey: string; note: string };
export type TeamLogVideoRow = { matchKey: string; url: string | null };

export type TeamLogField = { key: string; label: string };

export type TeamMatchLogRow = {
  matchKey: string;
  label: string;
  time: string | null;
  /** Null when TBA's schedule does not list the robot in this match (a hand-typed match). */
  alliance: "red" | "blue" | null;
  partners: string[];
  opponents: string[];
  /** Official (TBA), from this robot's alliance's side. Null until both scores are posted. */
  official: { result: "W" | "L" | "T"; us: number; them: number } | null;
  /** Observed by our scouts. */
  observed: {
    entries: number;
    /** Mean across entries of the formula / recorded total. Null without a basis. */
    total: number | null;
    /** Mean per key-field across entries that recorded it. */
    fields: Record<string, number | null>;
  };
  notes: string[];
  video: { url: string; source: "team" | "tba" } | null;
};

export type TeamMatchLog = {
  teamKey: string;
  rows: TeamMatchLogRow[];
  fields: TeamLogField[];
  /** How "total" was derived, or why there is none. */
  totalBasis: { ok: true; basis: "phase" | "total" } | { ok: false; reason: string };
};

/** Recorded-total keys: shown as the Total column, so not repeated as a field. */
const TOTAL_KEYS = new Set(["totalpoints", "total_points", "points", "score", "total"]);
const NOTE_KEY = /^(notes?|comments?|observations?)$/i;
const MAX_FIELDS = 4;

/** "teleopCycles" → "Teleop cycles", "auto_points" → "Auto points". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/**
 * The numeric fields worth a column: recorded as a number in at least half the
 * entries, most-recorded first, at most four. Identity fields and the recorded
 * total (already the Total column) are left out.
 */
export function keyNumericFields(entries: readonly TeamLogEntryRow[]): TeamLogField[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.payload ?? {})) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (TOTAL_KEYS.has(key.toLowerCase())) continue;
      if (isScoutIdentityField({ key, label: key })) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const floor = Math.max(1, Math.ceil(entries.length / 2));
  return [...counts.entries()]
    .filter(([, count]) => count >= floor)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_FIELDS)
    .map(([key]) => ({ key, label: fieldLabel(key) }));
}

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareMatchKeys(a: string, b: string): number {
  const left = matchOrderKey(a);
  const right = matchOrderKey(b);
  if (left && right) return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  if (left) return -1;
  if (right) return 1;
  return a.localeCompare(b);
}

export function buildTeamMatchLog(input: {
  teamKey: string;
  entries: readonly TeamLogEntryRow[];
  matches: readonly TeamLogMatchRow[];
  formulas: readonly OrgValueFormula[];
  notes?: readonly TeamLogNoteRow[];
  videos?: readonly TeamLogVideoRow[];
}): TeamMatchLog {
  const teamKey = input.teamKey;
  const fields = keyNumericFields(input.entries);

  const converted = scoutedRowsFromEntries(
    input.entries.map((entry) => ({ teamKey, matchKey: entry.matchKey, payload: entry.payload ?? {} })),
    input.formulas,
  );
  // The same one-row-per-match reduction the Robots list uses: two scouts are
  // averaged, and a robot recorded as disabled scores 0 for that match.
  const totalsByMatch = new Map<string, number[]>();
  if (converted.ok) {
    for (const row of onePerMatch(converted.rows)) {
      const total = matchRowTotal(row);
      if (total == null) continue;
      totalsByMatch.set(row.matchKey, [total]);
    }
  }

  const entriesByMatch = new Map<string, TeamLogEntryRow[]>();
  for (const entry of input.entries) {
    const list = entriesByMatch.get(entry.matchKey);
    if (list) list.push(entry);
    else entriesByMatch.set(entry.matchKey, [entry]);
  }
  const notesByMatch = new Map<string, string[]>();
  const addNote = (matchKey: string, note: string) => {
    const text = note.trim();
    if (!text) return;
    const list = notesByMatch.get(matchKey);
    if (list) {
      if (!list.includes(text)) list.push(text);
    } else notesByMatch.set(matchKey, [text]);
  };
  for (const entry of input.entries) {
    for (const [key, value] of Object.entries(entry.payload ?? {})) {
      if (NOTE_KEY.test(key) && typeof value === "string") addNote(entry.matchKey, value);
    }
  }
  for (const row of input.notes ?? []) addNote(row.matchKey, row.note);
  const teamVideo = new Map<string, string>();
  for (const row of input.videos ?? []) {
    const url = safeVideoUrl(row.url);
    if (url && !teamVideo.has(row.matchKey)) teamVideo.set(row.matchKey, url);
  }

  const matchByKey = new Map(input.matches.map((match) => [match.matchKey, match]));
  // Every match TBA has the robot in, plus any match our scouts filed that TBA does not list.
  const keys = new Set<string>();
  for (const match of input.matches) {
    const red = allianceTeamKeys(match.redAlliance);
    const blue = allianceTeamKeys(match.blueAlliance);
    if (red.includes(teamKey) || blue.includes(teamKey)) keys.add(match.matchKey);
  }
  for (const key of entriesByMatch.keys()) keys.add(key);

  const rows: TeamMatchLogRow[] = [...keys].sort(compareMatchKeys).map((matchKey) => {
    const match = matchByKey.get(matchKey);
    const red = match ? allianceTeamKeys(match.redAlliance) : [];
    const blue = match ? allianceTeamKeys(match.blueAlliance) : [];
    const alliance = red.includes(teamKey) ? "red" : blue.includes(teamKey) ? "blue" : null;
    const ours = alliance === "red" ? red : alliance === "blue" ? blue : [];
    const theirs = alliance === "red" ? blue : alliance === "blue" ? red : [];
    let official: TeamMatchLogRow["official"] = null;
    if (match && alliance) {
      const redScore = allianceScore(match.redAlliance);
      const blueScore = allianceScore(match.blueAlliance);
      if (redScore != null && blueScore != null) {
        const us = alliance === "red" ? redScore : blueScore;
        const them = alliance === "red" ? blueScore : redScore;
        official = { result: us === them ? "T" : us > them ? "W" : "L", us, them };
      }
    }
    const matchEntries = entriesByMatch.get(matchKey) ?? [];
    const fieldMeans: Record<string, number | null> = {};
    for (const field of fields) {
      fieldMeans[field.key] = mean(
        matchEntries
          .map((entry) => entry.payload?.[field.key])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
      );
    }
    const team = teamVideo.get(matchKey);
    const tba = match ? tbaVideoUrl(match.tbaVideoType, match.tbaVideoKey) : null;
    return {
      matchKey,
      label: match
        ? shortMatchLabel(match.compLevel, match.setNumber, Number(match.matchNumber))
        : labelFromKey(matchKey),
      time: match?.time ?? null,
      alliance,
      partners: ours.filter((key) => key !== teamKey),
      opponents: theirs,
      official,
      observed: {
        entries: matchEntries.length,
        total: mean(totalsByMatch.get(matchKey) ?? []),
        fields: fieldMeans,
      },
      notes: notesByMatch.get(matchKey) ?? [],
      video: team ? { url: team, source: "team" } : tba ? { url: tba, source: "tba" } : null,
    };
  });

  return {
    teamKey,
    rows,
    fields,
    totalBasis: converted.ok ? { ok: true, basis: converted.basis } : { ok: false, reason: converted.reason },
  };
}

function labelFromKey(matchKey: string): string {
  const order = matchOrderKey(matchKey);
  if (!order) return matchKey;
  const levels = ["qm", "ef", "qf", "sf", "f"];
  const level = levels[order[0]] ?? "qm";
  return level === "qm" ? shortMatchLabel(level, null, order[1]) : shortMatchLabel(level, order[1], order[2]);
}

/** Matches needed before an average is shown rather than "not enough matches". */
export const MIN_SUMMARY_MATCHES = 2;

export type SummaryStat = { matches: number; value: number | null };

export type TeamMatchSummary = {
  /** Matches with an observed total. */
  matches: number;
  average: number | null;
  best: number | null;
  worst: number | null;
  /** Mean of the latest three matches with a total, in schedule order. */
  lastThree: number | null;
  relative: {
    teamKey: string;
    with: SummaryStat;
    against: SummaryStat;
  } | null;
};

/**
 * Summary chips over the observed totals. Every figure needs at least
 * MIN_SUMMARY_MATCHES matches behind it; below that it is null and the UI says
 * "not enough matches" rather than dressing one match up as an average.
 */
export function summarizeTeamMatches(
  rows: readonly TeamMatchLogRow[],
  options: { relativeTo?: string | null } = {},
): TeamMatchSummary {
  const scored = rows.filter((row) => row.observed.total != null);
  const totals = scored.map((row) => row.observed.total as number);
  const enough = totals.length >= MIN_SUMMARY_MATCHES;
  const stat = (subset: readonly TeamMatchLogRow[]): SummaryStat => ({
    matches: subset.length,
    value: subset.length >= MIN_SUMMARY_MATCHES ? mean(subset.map((row) => row.observed.total as number)) : null,
  });
  const relativeTo = options.relativeTo?.trim() || null;
  return {
    matches: totals.length,
    average: enough ? mean(totals) : null,
    best: enough ? Math.max(...totals) : null,
    worst: enough ? Math.min(...totals) : null,
    lastThree: enough ? mean(totals.slice(-3)) : null,
    relative: relativeTo
      ? {
          teamKey: relativeTo,
          with: stat(scored.filter((row) => row.partners.includes(relativeTo))),
          against: stat(scored.filter((row) => row.opponents.includes(relativeTo))),
        }
      : null,
  };
}

/** Teams this robot shared a field with, most-shared first — the "with / against" picker. */
export function sharedFieldTeams(rows: readonly TeamMatchLogRow[]): Array<{ teamKey: string; matches: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of [...row.partners, ...row.opponents]) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([teamKey, matches]) => ({ teamKey, matches }))
    .sort((a, b) => b.matches - a.matches || a.teamKey.localeCompare(b.teamKey, undefined, { numeric: true }));
}
