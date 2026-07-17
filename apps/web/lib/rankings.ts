// Event Rankings & Playoff Bracket — framework-free domain logic shared by the
// API route, the client UI, and unit tests. No server or React imports here.

export type RankedTeam = {
  teamKey: string;
  /** Parsed from the key: "frc254" → 254 (0 when unparseable). */
  teamNumber: number;
  nickname: string | null;
  rank: number | null;
  /** "10-2-0" style W-L-T record, or null when the source has no record. */
  record: string | null;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  /** Metrics provenance, e.g. "statbotics" or "tba". */
  source: string | null;
};

export type PlayoffMatch = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  /** Human label from parsePlayoffLabel, e.g. "QF 1-2" or "Final 3". */
  label: string;
  red: string[];
  blue: string[];
  redScore: number | null;
  blueScore: number | null;
  winner: "red" | "blue" | null;
  /** COALESCE(actual_time, predicted_time, event_time) as text, or null. */
  scheduledTime: string | null;
};

export type RankingsContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  eventKey: string | null;
  eventName: string | null;
};

export type RankingsView =
  | {
      status: "ready";
      context: RankingsContext;
      teams: RankedTeam[];
      playoffs: PlayoffMatch[];
      syncedAt: string | null;
    }
  | { status: "setup_required"; context: RankingsContext; message: string };

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

/** "frc1678" → "1678" for compact display. */
export function stripFrc(teamKey: string): string {
  return teamKey.startsWith("frc") ? teamKey.slice(3) : teamKey;
}

/** "" for null/unparsable, else e.g. "Sat 9:41 AM" in the viewer's locale. */
export function fmtRankTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** "frc254" → 254 (also accepts bare "254"); 0 when unparseable. */
export function teamNumberFromKey(teamKey: string): number {
  const digits = teamKey.startsWith("frc") ? teamKey.slice(3) : teamKey;
  const parsed = Number.parseInt(digits, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** "10-2-0" from W/L/T counts (nulls treated as 0); null when all are null. */
export function formatRecord(wins: number | null, losses: number | null, ties: number | null): string | null {
  if (wins == null && losses == null && ties == null) return null;
  return `${wins ?? 0}-${losses ?? 0}-${ties ?? 0}`;
}

/** New array: rank asc (nulls last), then EPA total desc (nulls last), then team number asc. */
export function sortRanked(teams: RankedTeam[]): RankedTeam[] {
  return [...teams].sort((a, b) => {
    if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank != null && b.rank == null) return -1;
    if (a.rank == null && b.rank != null) return 1;
    if (a.epaTotal != null && b.epaTotal != null && a.epaTotal !== b.epaTotal) return b.epaTotal - a.epaTotal;
    if (a.epaTotal != null && b.epaTotal == null) return -1;
    if (a.epaTotal == null && b.epaTotal != null) return 1;
    return a.teamNumber - b.teamNumber;
  });
}

export type Standing = { rank: number; of: number; percentile: number };

/**
 * Our team's standing among ranked teams, or null when absent or unranked.
 * `of` counts teams that have a rank; percentile is top-N-percent rounded.
 */
export function ourStanding(teams: RankedTeam[], teamKey: string): Standing | null {
  const ours = teams.find((team) => team.teamKey === teamKey);
  if (!ours || ours.rank == null) return null;
  const of = teams.filter((team) => team.rank != null).length;
  const percentile = Math.round((1 - (ours.rank - 1) / of) * 100);
  return { rank: ours.rank, of, percentile };
}

const PLAYOFF_KEY_RE = /^.*_(qf|sf|f|ef)(\d+)m(\d+)$/;

/** Set/match parsed from a playoff match key, or null when it does not parse. */
function parseSetMatch(matchKey: string): { level: string; set: number; match: number } | null {
  const parsed = PLAYOFF_KEY_RE.exec(matchKey);
  if (!parsed) return null;
  const [, level = "", set = "", match = ""] = parsed;
  return { level, set: Number.parseInt(set, 10), match: Number.parseInt(match, 10) };
}

/** "QF 1-2" from "…_qf1m2", "SF 2-1", "Final 3"; fallback "LEVEL matchNumber". */
export function parsePlayoffLabel(matchKey: string, compLevel: string, matchNumber: number): string {
  const parsed = parseSetMatch(matchKey);
  if (!parsed) return `${compLevel.toUpperCase()} ${matchNumber}`;
  if (parsed.level === "f") return `Final ${parsed.match}`;
  return `${parsed.level.toUpperCase()} ${parsed.set}-${parsed.match}`;
}

export type PlayoffGroup = { level: string; label: string; matches: PlayoffMatch[] };

const PLAYOFF_LEVEL_ORDER: Record<string, number> = { ef: 0, qf: 1, sf: 2, f: 3 };
const PLAYOFF_LEVEL_LABELS: Record<string, string> = { qf: "Quarterfinals", sf: "Semifinals", f: "Finals" };

/**
 * Group by comp level ordered ef→qf→sf→f (unknown levels last), each group
 * sorted by set then match number parsed from the key (fallback matchNumber).
 */
export function groupPlayoffs(matches: PlayoffMatch[]): PlayoffGroup[] {
  const byLevel = new Map<string, PlayoffMatch[]>();
  for (const match of matches) {
    const bucket = byLevel.get(match.compLevel);
    if (bucket) bucket.push(match);
    else byLevel.set(match.compLevel, [match]);
  }
  const levels = [...byLevel.keys()].sort(
    (a, b) => (PLAYOFF_LEVEL_ORDER[a] ?? 9) - (PLAYOFF_LEVEL_ORDER[b] ?? 9),
  );
  return levels.map((level) => ({
    level,
    label: PLAYOFF_LEVEL_LABELS[level] ?? level.toUpperCase(),
    matches: [...(byLevel.get(level) ?? [])].sort((a, b) => {
      const ka = parseSetMatch(a.matchKey) ?? { set: 0, match: a.matchNumber };
      const kb = parseSetMatch(b.matchKey) ?? { set: 0, match: b.matchNumber };
      return ka.set !== kb.set ? ka.set - kb.set : ka.match - kb.match;
    }),
  }));
}

/** 0–100 integer percent of maxEpa, clamped; 0 when epa is null or max <= 0. */
export function epaBarWidth(epa: number | null, maxEpa: number): number {
  if (epa == null || maxEpa <= 0) return 0;
  const percent = Math.round((epa / maxEpa) * 100);
  return Math.min(100, Math.max(0, percent));
}
