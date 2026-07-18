// Match Simulator domain types. Pure data shapes — no I/O, no framework imports.
// A "match sim" projects a per-alliance score TIMELINE (auto / teleop / endgame) from real,
// synced EPA capability data (team_event_metrics / team_year_metrics) — never fabricated —
// and surfaces the single highest-leverage lever a coach could pull to change the outcome.

export type MatchPhase = "auto" | "teleop" | "endgame";

export type AllianceColor = "red" | "blue";

/** A single scouted/EPA-backed team contributing to an alliance's simulated capability. */
export type TeamCapability = {
  teamKey: string;
  teamNumber: number | null;
  /** Points-per-match EPA broken into phases; null when the phase has no synced data. */
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  epaTotal: number | null;
  source: string | null;
  hasData: boolean;
};

/** Summed alliance-level capability for a phase, tracking how much of it is real data. */
export type AllianceCapability = {
  color: AllianceColor;
  teams: TeamCapability[];
  auto: number;
  teleop: number;
  endgame: number;
  total: number;
  /** Fraction (0..1) of alliance teams that had at least one synced EPA number. */
  dataCompleteness: number;
};

/** One point on the cumulative predicted score timeline. */
export type TimelinePoint = {
  tSeconds: number;
  label: string;
  phase: MatchPhase;
  redScore: number;
  blueScore: number;
};

export type LeverageLever = {
  alliance: AllianceColor;
  phase: MatchPhase;
  teamKey: string | null;
  teamNumber: number | null;
  /** Points the disadvantaged alliance is trailing by in this phase. */
  phaseGap: number;
  /** Estimated swing to the final margin if this phase gap were closed. */
  marginSwing: number;
  rationale: string;
};

export type MatchSimResult = {
  red: AllianceCapability;
  blue: AllianceCapability;
  timeline: TimelinePoint[];
  finalMargin: number;
  favored: AllianceColor | "even";
  lever: LeverageLever | null;
  computedAt: string;
};

export type MatchSimRun = {
  id: string;
  label: string;
  eventKey: string | null;
  matchKey: string | null;
  redTeamKeys: string[];
  blueTeamKeys: string[];
  result: MatchSimResult;
  createdAt: string;
};

export type MatchSimSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MatchSimView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchSimSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      runs: MatchSimRun[];
      active: MatchSimRun | null;
      computedAt: string;
    };
