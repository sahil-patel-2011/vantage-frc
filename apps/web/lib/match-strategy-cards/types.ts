// Match Strategy Cards domain types. Pure data shapes — no I/O, no framework imports.
// A "card" is the drive team's printable, editable game plan for one scheduled match:
// roles, auto assignment, defense focus, key threats. Distinct from the win/loss prediction
// engine in packages/prediction-strategy — this is human-authored content, not computed odds.

export type AllianceColor = "red" | "blue";

export type MatchStrategyRoleAssignment = {
  role: string;
  assignee: string;
};

export type MatchStrategyAlliance = {
  color: AllianceColor;
  teamNumbers: number[];
  isOwnAlliance: boolean;
};

export type MatchStrategyCard = {
  id: string;
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  setNumber: number;
  eventKey: string;
  scheduledAt: string | null;
  alliances: MatchStrategyAlliance[];
  ownAllianceColor: AllianceColor | null;
  gamePlan: string | null;
  autoAssignment: string | null;
  defenseFocus: string | null;
  keyThreats: string | null;
  driverNotes: string | null;
  roleAssignments: MatchStrategyRoleAssignment[];
  hasCard: boolean;
  updatedAt: string | null;
};
