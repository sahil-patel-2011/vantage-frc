// Defensive matchup planner domain types. Pure data shapes — no I/O, no framework imports.
// For the next opponent: weigh OUR mass + drivetrain against THEIR scouted cycle path
// (cycle time, points/cycle) to compute whether/whom to play defense.

export type DrivetrainType = "west_coast" | "swerve" | "mecanum" | "tank" | "other";

export type DefenseRecommendation = "play_defense" | "stay_offense" | "situational";

export type AssignedDefender = "us" | "none" | "situational";

export type RobotProfile = {
  seasonYear: number;
  massLbs: number;
  drivetrain: DrivetrainType;
  topSpeedFps: number | null;
  notes: string;
  updatedAt: string;
};

/** Pure computed recommendation for a single matchup, given profile + scouted inputs. */
export type DefensePlan = {
  denialValuePerMinute: number;
  massRatio: number;
  containmentScore: number;
  recommendation: DefenseRecommendation;
  assignedDefender: AssignedDefender;
  confidence: number;
  rationale: string;
};

export type Matchup = {
  id: string;
  seasonYear: number;
  opponentTeamNumber: number;
  opponentTeamName: string;
  eventKey: string | null;
  opponentMassLbs: number;
  opponentDrivetrain: DrivetrainType;
  opponentCycleTimeSec: number;
  opponentCyclePath: string;
  opponentAvgPointsPerCycle: number;
  notes: string;
  recommendation: DefenseRecommendation;
  assignedDefender: AssignedDefender;
  confidence: number;
  rationale: string;
  computedAt: string;
  createdAt: string;
};
