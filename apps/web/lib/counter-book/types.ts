// Opponent counter-book domain types. Pure data shapes — no I/O, no framework imports.
// A counter-book is a one-page counter-strategy for a likely playoff opponent, built ONLY
// from this org's own scouted observations of that team (match_scout_entries / pit_scout_entries).

/** A quantified tendency inferred from scouted numeric fields for the opponent (e.g. avg auto points). */
export type CounterBookTendency = {
  field: string;
  average: number;
  sampleSize: number;
  /** Coefficient of variation (stdev / mean) — high values flag inconsistency, not a metric to fabricate. */
  variability: number;
};

/** A condition under which the opponent's performance drops, inferred from variance across scouted matches. */
export type CounterBookFailureTrigger = {
  field: string;
  detail: string;
  variability: number;
};

export type CounterBookReport = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  eventKey: string | null;
  title: string;
  matchesScouted: number;
  tendencies: CounterBookTendency[];
  failureTriggers: CounterBookFailureTrigger[];
  counterPlan: string;
  summary: string;
  createdAt: string;
};
