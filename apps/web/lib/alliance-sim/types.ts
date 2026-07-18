// Alliance Sim domain types. Pure data shapes — no I/O, no framework imports.
// Models a prospective playoff alliance: which physical endgame/scoring roles each robot
// can fill, the resulting optimal role assignment, physical role conflicts (more capable
// robots than a role has room for), and a coverage-derived win-probability estimate.

/** Fixed, game-agnostic catalog of physical roles a robot can occupy during a match. */
export type AllianceSimRole =
  | "primary_climb"
  | "secondary_climb"
  | "primary_score_high"
  | "primary_score_low"
  | "defense"
  | "feeder"
  | "auto_mobility";

export type AllianceSimRoleDef = {
  role: AllianceSimRole;
  label: string;
  /** Max robots that can simultaneously occupy this role in a single match. */
  capacity: number;
  /** Essential roles weigh into the win-probability essential-coverage component. */
  essential: boolean;
};

export type AllianceSimRobot = {
  id: string;
  teamNumber: number;
  teamName: string | null;
  capableRoles: AllianceSimRole[];
  /** 1-5 strength rating per capable role; unrated roles fall back to a default. */
  roleStrengths: Partial<Record<AllianceSimRole, number>>;
};

export type AllianceSimScenario = {
  id: string;
  name: string;
  eventName: string | null;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
};

export type RoleAssignment = {
  role: AllianceSimRole;
  robotId: string;
  teamNumber: number;
  strength: number;
};

export type RoleConflict = {
  role: AllianceSimRole;
  capacity: number;
  contenders: Array<{ robotId: string; teamNumber: number; strength: number }>;
  unassigned: Array<{ robotId: string; teamNumber: number }>;
};

export type AllianceSimResult = {
  assignments: RoleAssignment[];
  conflicts: RoleConflict[];
  /** 0..1 ratio of assigned strength to each robot's best-capable-role strength ceiling. */
  coverageRatio: number;
  /** 0..1 fraction of essential roles that were filled by some robot. */
  essentialCoverage: number;
  /** 0..1 derived win-probability estimate blending coverage and essential-role fill. */
  winProbability: number;
  totalStrength: number;
  maxPossibleStrength: number;
};
