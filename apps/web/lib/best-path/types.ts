/**
 * Best Path seed planner — pure domain types.
 *
 * Projects a final qualification seed from REAL cached standings plus the
 * remaining qualification schedule, lets a strategy table force individual match
 * outcomes ("what if we beat 254 in Q78?"), and searches for the smallest set of
 * forced outcomes that reaches the best reachable seed.
 *
 * No I/O, no framework imports, no AI.
 */

export type AllianceOutcome = "red" | "blue" | "tie";

export type AllianceSide = "red" | "blue";

/**
 * Ranking-point values for a season. FRC has changed these: 2016–2024 paid 2 RP
 * for a win, 2025 (Reefscape) pays 3. `confirmed` is false when the most recent
 * known table is being applied to a season whose manual is not encoded here —
 * the UI must say so rather than present the projection as settled fact.
 */
export type RankingPointRules = {
  win: number;
  tie: number;
  loss: number;
  year: number | null;
  label: string;
  confirmed: boolean;
};

/** One team's real, already-earned standing at the event. */
export type StandingTeam = {
  teamKey: string;
  /** Ranking points already banked (official breakdown sum, or record x rules). */
  rankingPoints: number;
  /** Quals already played. */
  played: number;
  /** Official current rank — the deterministic tiebreak for projected ties. */
  currentRank: number | null;
};

/** One unplayed qualification match. `predicted` is null when there is no basis. */
export type RemainingMatch = {
  matchKey: string;
  matchNumber: number;
  red: string[];
  blue: string[];
  predicted: AllianceOutcome | null;
};

/** matchKey -> forced outcome. Anything absent uses the match's own prediction. */
export type OutcomeOverrides = Record<string, AllianceOutcome>;

export type ProjectedRow = {
  teamKey: string;
  rankingPoints: number;
  projectedRankingPoints: number;
  gained: number;
  played: number;
  projectedPlayed: number;
  projectedRank: number;
  currentRank: number | null;
  /** currentRank minus projectedRank. Positive = moves up. Null without a rank. */
  rankDelta: number | null;
  /** Remaining matches for this team with neither a prediction nor an override. */
  undecidedMatches: number;
};

export type SeedProjection = {
  rows: ProjectedRow[];
  byTeam: Record<string, ProjectedRow>;
  rules: RankingPointRules;
  decidedMatches: number;
  undecidedMatches: number;
  /** Teams that appear in the schedule but have no standings row — never invented. */
  unknownTeams: string[];
};

export type BestPathFlip = {
  matchKey: string;
  matchNumber: number;
  red: string[];
  blue: string[];
  /** The outcome the plan forces. */
  outcome: AllianceOutcome;
  /** What the match was projected to do before the flip (null = no prediction). */
  predicted: AllianceOutcome | null;
  /** Which side our team is on, or null when this is somebody else's match. */
  ourSide: AllianceSide | null;
};

export type BestPathLimits = {
  /** Remaining matches considered controllable. Matches involving us come first. */
  maxCandidates: number;
  /** Largest number of simultaneous flips searched. */
  maxDepth: number;
  /** Hard evaluation budget so the browser search always terminates. */
  maxEvaluations: number;
  /** Rival window: teams within this many projected ranks of us are relevant. */
  rankWindow: number;
};

export type BestPathResult = {
  teamKey: string;
  /** Seed with nothing forced beyond the caller's existing overrides. */
  baselineRank: number | null;
  /** Best seed found inside the searched space. */
  bestRank: number | null;
  /** Smallest flip set that reaches bestRank (empty when baseline is already best). */
  flips: BestPathFlip[];
  candidateMatches: number;
  consideredMatches: number;
  evaluations: number;
  depthSearched: number;
  /** True when a deterministic cap stopped the search — say so, never imply exhaustive. */
  capped: boolean;
  cappedReason: string | null;
  /** Provable floor: this many teams stay ahead of us no matter what. */
  floorRank: number | null;
  limits: BestPathLimits;
};
