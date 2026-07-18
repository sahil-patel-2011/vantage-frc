// Scout Data Impact domain types. Pure data shapes — no I/O, no framework imports.
// After alliance selection, this correlates each logged pick's team against the
// match-scouting entries that were recorded for that team, so every scout can see
// which of their entries informed which pick — the "where your data went" feedback loop.

export type ScoutDataImpactPick = {
  id: string;
  eventKey: string;
  teamKey: string;
  teamNumber: number | null;
  allianceNumber: number;
  pickOrder: number;
  notes: string | null;
  loggedBy: string;
  createdAt: string;
};

/** One scout's contribution toward one pick. */
export type ScoutContribution = {
  scoutUserId: string;
  scoutName: string;
  entryCount: number;
  matchKeys: string[];
};

export type PickImpact = {
  pick: ScoutDataImpactPick;
  totalEntries: number;
  contributions: ScoutContribution[];
};

/** Per-scout rollup: what each scout's data contributed across every logged pick. */
export type ScoutImpactSummary = {
  scoutUserId: string;
  scoutName: string;
  picksInformed: number;
  totalEntries: number;
  teamsScoutedThatWerePicked: string[];
};
