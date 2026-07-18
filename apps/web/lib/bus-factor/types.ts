// Bus-factor / burnout early-warning domain types. Pure data shapes — no I/O, no framework
// imports. Privacy-safe: only aggregated hours/task counts, never individual performance notes.

export type BusFactorArea =
  | "mechanical"
  | "electrical"
  | "software"
  | "strategy"
  | "scouting"
  | "business"
  | "admin"
  | "other";

export type WorkloadEntry = {
  id: string;
  memberUserId: string;
  memberName: string;
  area: BusFactorArea;
  weekStart: string; // ISO date (YYYY-MM-DD)
  hoursLogged: number;
  tasksOwned: number;
  soleKnowledgeCount: number;
};

export type AreaConcentration = {
  area: BusFactorArea;
  contributors: number;
  totalHours: number;
  totalTasksOwned: number;
  totalSoleKnowledge: number;
  /** 0..1 — 1 means a single person carries all hours/tasks in this area. */
  concentrationScore: number;
  topContributorName: string | null;
  topContributorShare: number;
};

export type MemberWorkload = {
  memberUserId: string;
  memberName: string;
  totalHours: number;
  totalTasksOwned: number;
  totalSoleKnowledge: number;
  areas: BusFactorArea[];
  /** Ratio of this member's hours to the team's mean weekly hours across active members. */
  overloadRatio: number;
};

export type RiskLevel = "low" | "watch" | "high";

export type RiskFlag = {
  id: string;
  level: RiskLevel;
  kind: "concentration" | "overload" | "sole_knowledge";
  memberName: string | null;
  area: BusFactorArea | null;
  detail: string;
};

export type BusFactorSummary = {
  weeksCovered: number;
  activeMembers: number;
  totalHours: number;
  meanWeeklyHoursPerMember: number;
  areaConcentration: AreaConcentration[];
  memberWorkloads: MemberWorkload[];
  flags: RiskFlag[];
  /** 0..1 overall organizational risk signal, higher = more single-point-of-failure/overload risk. */
  riskScore: number;
  riskLevel: RiskLevel;
};
