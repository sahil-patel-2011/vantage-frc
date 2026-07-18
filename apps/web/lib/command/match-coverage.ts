/** Pure match-row coverage helpers for Event Day Command (CD #5 / #8). */

export type CoverageState = "missing" | "assigned" | "covered" | "double_covered";

export type CoverageCell = {
  matchKey: string;
  teamKey: string;
  assignmentCount: number;
  entryCount: number;
};

export type CoverageBoardCell = CoverageCell & {
  matchNumber: number;
  compLevel: string;
  state: CoverageState;
};

export function coverageState(cell: CoverageCell): CoverageState {
  if (cell.entryCount > 1) return "double_covered";
  if (cell.entryCount === 1) return "covered";
  if (cell.assignmentCount > 0) return "assigned";
  return "missing";
}

function toCountMap(value?: Map<string, number> | Record<string, number>): Map<string, number> {
  if (!value) return new Map();
  if (value instanceof Map) return value;
  return new Map(Object.entries(value).map(([key, count]) => [key, Number(count) || 0]));
}

export function buildCoverageBoard(input: {
  matches: Array<{ matchKey: string; matchNumber: number; compLevel: string; teamKeys: string[] }>;
  assignmentCounts?: Map<string, number> | Record<string, number>;
  entryCounts?: Map<string, number> | Record<string, number>;
}): CoverageBoardCell[] {
  const assignments = toCountMap(input.assignmentCounts);
  const entries = toCountMap(input.entryCounts);
  return input.matches.flatMap((match) =>
    match.teamKeys.map((teamKey) => {
      const key = `${match.matchKey}|${teamKey}`;
      const cell: CoverageCell = {
        matchKey: match.matchKey,
        teamKey,
        assignmentCount: assignments.get(key) ?? 0,
        entryCount: entries.get(key) ?? 0,
      };
      return {
        ...cell,
        matchNumber: match.matchNumber,
        compLevel: match.compLevel,
        state: coverageState(cell),
      };
    }),
  );
}

export function summarizeCoverageBoard(cells: Array<{ state: CoverageState }>) {
  let missing = 0;
  let assigned = 0;
  let covered = 0;
  let doubleCovered = 0;
  for (const cell of cells) {
    if (cell.state === "missing") missing += 1;
    else if (cell.state === "assigned") assigned += 1;
    else if (cell.state === "covered") covered += 1;
    else doubleCovered += 1;
  }
  return { missing, assigned, covered, doubleCovered, total: cells.length };
}

export function coverageGapFingerprint(
  cells: Array<{ matchKey: string; teamKey: string; state?: CoverageState }>,
): string {
  return cells
    .filter((cell) => !cell.state || cell.state === "missing")
    .map((cell) => `${cell.matchKey}:${cell.teamKey}`)
    .sort()
    .join("|");
}

export function coverageGapMessage(input: {
  eventKey: string;
  missing: number;
  sample?: Array<{ matchKey: string; teamKey: string; matchNumber?: number; compLevel?: string }>;
}): string {
  const sample = (input.sample ?? [])
    .slice(0, 3)
    .map((row) => {
      const team = row.teamKey.replace(/^frc/i, "");
      const match =
        row.compLevel && row.matchNumber != null
          ? `${row.compLevel.toUpperCase()} ${row.matchNumber}`
          : row.matchKey;
      return `${match} · ${team}`;
    })
    .join("; ");
  const head =
    input.missing === 1
      ? `1 scouting row is uncovered at ${input.eventKey}`
      : `${input.missing} scouting rows are uncovered at ${input.eventKey}`;
  return sample ? `${head}: ${sample}.` : `${head}.`;
}
