/**
 * The one way to name a match.
 *
 * Since 2023 FRC playoffs are double elimination: The Blue Alliance stores the bracket as
 * comp level `sf` with sets 1–13 (one match each) and the finals as `f` set 1, matches 1–3.
 * Printing those as "Semi 13-1" named a semifinal that does not exist. The field and the
 * bracket call them "Match 13" and "Final 2"; here they read "Playoff 13" and "Final 2".
 * Events before 2023 used best-of-three rounds, so their quarters and semis keep set-match.
 */
export type MatchLabelInput = {
  compLevel: string;
  setNumber?: number | null;
  matchNumber: number;
  /** The event's year; from a match key's first four digits when not given. */
  year?: number | null;
  matchKey?: string | null;
};

const ROUND: Record<string, string> = { ef: "Eighth", qf: "Quarter", sf: "Semi" };

const DOUBLE_ELIMINATION_FROM = 2023;

function yearOf(input: MatchLabelInput): number | null {
  if (input.year != null && Number.isFinite(input.year)) return input.year;
  const fromKey = /^(\d{4})/.exec(input.matchKey ?? "")?.[1];
  return fromKey ? Number(fromKey) : null;
}

function positive(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** "Qual 12", "Playoff 5", "Final 2" (2023+), "Semi 2-1" (before 2023). */
export function matchLabel(input: MatchLabelInput): string {
  const level = (input.compLevel || "").toLowerCase();
  const match = positive(input.matchNumber) ?? 0;
  const set = positive(input.setNumber);
  if (level === "qm" || !level) return `Qual ${match}`;
  if (level === "f") return `Final ${match}`;
  const year = yearOf(input);
  // A double-elimination bracket slot: its set is the bracket match number.
  if (level === "sf" && (year == null || year >= DOUBLE_ELIMINATION_FROM) && (set == null || match === 1)) {
    return `Playoff ${set ?? match}`;
  }
  const round = ROUND[level] ?? level.toUpperCase();
  return set ? `${round} ${set}-${match}` : `${round} ${match}`;
}

/** Parses `2026casj_qm12`, `2026casj_sf5m1`, `2026casj_f1m2`; null when the key is not a match key. */
export function matchLabelFromKey(matchKey: string): string | null {
  const parsed = /_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(matchKey.trim());
  if (!parsed) return null;
  const [, level = "qm", first = "0", second] = parsed;
  const compLevel = level.toLowerCase();
  return compLevel === "qm"
    ? matchLabel({ compLevel, matchNumber: Number(first), matchKey })
    : matchLabel({ compLevel, setNumber: Number(first), matchNumber: Number(second ?? 1), matchKey });
}
