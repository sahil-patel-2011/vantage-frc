export * from "./types";

import type { Alliance, CoverageCell, CoverageStatus, CoverageSummary } from "./types";

export const DEFAULT_THIN_THRESHOLD = 2;

/** Classifies a match/team's raw scouting-entry count against the org's "thin" threshold. */
export function coverageStatusFor(entryCount: number, thinThreshold: number): CoverageStatus {
  if (entryCount <= 0) return "zero";
  if (entryCount < thinThreshold) return "thin";
  return "covered";
}

/** Human match label, mirroring TBA comp-level conventions (qm/sf/f). */
export function matchLabel(compLevel: string, setNumber: number, matchNumber: number): string {
  const level = (compLevel || "").toLowerCase();
  if (level === "qm") return `Qual ${matchNumber}`;
  if (level === "sf") return `Semi ${setNumber}-${matchNumber}`;
  if (level === "f") return `Final ${matchNumber}`;
  return `${compLevel || "Match"} ${setNumber}-${matchNumber}`;
}

/**
 * Extracts alliance team keys from the stored matches_ref jsonb.
 *
 * The reference writer persists the camelCase `teamKeys` shape (packages/reference AllianceRecord);
 * raw TBA payloads and older rows use `team_keys`, and some callers hand in a bare string array.
 * All three resolve here so a coverage board never reads an empty schedule off a shape mismatch.
 */
export function teamKeysFromAlliance(
  value: { team_keys?: unknown; teamKeys?: unknown } | unknown[] | null | undefined,
): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (!value || typeof value !== "object") return [];
  const record = value as { team_keys?: unknown; teamKeys?: unknown };
  const keys = Array.isArray(record.teamKeys)
    ? record.teamKeys
    : Array.isArray(record.team_keys)
      ? record.team_keys
      : null;
  if (!keys) return [];
  return keys.filter((v): v is string => typeof v === "string");
}

export type CoverageMatchInput = {
  matchKey: string;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  redTeamKeys: string[];
  blueTeamKeys: string[];
};

/**
 * Builds one coverage cell per (match, team) pair the schedule actually contains. Skips teams
 * with no known team_number mapping (unsynced reference data) rather than fabricating one.
 */
export function buildCoverageCells(input: {
  matches: CoverageMatchInput[];
  entryCounts: Map<string, number>;
  teamNumbers: Map<string, number>;
  thinThreshold: number;
}): CoverageCell[] {
  const cells: CoverageCell[] = [];
  for (const match of input.matches) {
    const label = matchLabel(match.compLevel, match.setNumber, match.matchNumber);
    const sides: Array<[Alliance, string[]]> = [
      ["red", match.redTeamKeys],
      ["blue", match.blueTeamKeys],
    ];
    for (const [alliance, teamKeys] of sides) {
      for (const teamKey of teamKeys) {
        const teamNumber = input.teamNumbers.get(teamKey);
        if (teamNumber == null) continue;
        const entryCount = input.entryCounts.get(`${match.matchKey}::${teamKey}`) ?? 0;
        cells.push({
          matchKey: match.matchKey,
          matchLabel: label,
          compLevel: match.compLevel,
          matchNumber: match.matchNumber,
          teamKey,
          teamNumber,
          alliance,
          entryCount,
          status: coverageStatusFor(entryCount, input.thinThreshold),
        });
      }
    }
  }
  return cells;
}

export function summarizeCoverage(cells: CoverageCell[]): CoverageSummary {
  const totalCells = cells.length;
  const zeroCount = cells.filter((c) => c.status === "zero").length;
  const thinCount = cells.filter((c) => c.status === "thin").length;
  const coveredCount = cells.filter((c) => c.status === "covered").length;
  return {
    totalCells,
    zeroCount,
    thinCount,
    coveredCount,
    coveragePct: totalCells > 0 ? coveredCount / totalCells : 0,
  };
}

/** Ranks the worst coverage gaps (zero before thin) in schedule order, for the nudge queue. */
export function rankCoverageGaps(cells: CoverageCell[], limit = 15): CoverageCell[] {
  const severity: Record<CoverageStatus, number> = { zero: 0, thin: 1, covered: 2 };
  return cells
    .filter((c) => c.status !== "covered")
    .slice()
    .sort((a, b) => severity[a.status] - severity[b.status] || a.matchNumber - b.matchNumber)
    .slice(0, limit);
}
