// District/Season Qualification Trajectory Simulator domain types. Pure data shapes — no I/O.
// The simulator projects a rostered team's remaining district-qualifier + DCMP points from real
// cached EPA/OPR (packages/reference TBA/Statbotics tables) and the district's real remaining
// event schedule. Nothing here is fabricated: absent cached inputs produce a setup_required view.

export type TrajectoryPoint = {
  /** Cumulative district points at this percentile of the simulated distribution. */
  points: number;
  /** Probability mass at/under this point value, 0..1 (for the probability curve). */
  cumulativeProbability: number;
};

export type TrajectoryScenario = {
  id: string;
  label: string;
  /** Percent change applied to the baseline EPA before simulating, e.g. 0.05 = +5%. */
  epaDeltaPct: number;
  skipNextEvent: boolean;
  createdAt: string;
};

export type TrajectoryRunSummary = {
  id: string;
  simRuns: number;
  baselineEpa: number | null;
  eventsRemaining: number;
  qualifyProbability: number;
  pointsNeeded: number | null;
  projectedPointsP10: number | null;
  projectedPointsP50: number | null;
  projectedPointsP90: number | null;
  probabilityCurve: TrajectoryPoint[];
  createdAt: string;
};

export type RemainingEvent = {
  eventKey: string;
  name: string;
  startDate: string | null;
};

export type TrajectorySimulationInput = {
  baselineEpa: number;
  fieldEpaMean: number;
  fieldEpaStdDev: number;
  fieldSize: number;
  eventsRemaining: number;
  simRuns: number;
  /** Fractional EPA adjustment applied for a what-if scenario, e.g. 0.05 = +5%. */
  epaDeltaPct?: number;
};

export type TrajectorySimulationResult = {
  qualifyProbability: number;
  pointsNeeded: number | null;
  projectedPointsP10: number;
  projectedPointsP50: number;
  projectedPointsP90: number;
  probabilityCurve: TrajectoryPoint[];
};
