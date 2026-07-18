// Leadership Continuity domain types. Pure data shapes — no I/O, no framework imports.
// Tracks named leadership/technical roles, their current holder, an identified successor,
// and where that handoff stands — the succession-planning record for officer and mentor
// transitions (distinct from bus-factor workload concentration, which is task-derived).

export type LeadershipCategory = "leadership" | "technical" | "mentor" | "business" | "safety" | "other";

export type LeadershipHandoffStatus =
  | "not_started"
  | "identified"
  | "in_training"
  | "ready"
  | "completed";

export type LeadershipRole = {
  id: string;
  roleTitle: string;
  category: LeadershipCategory;
  holderName: string;
  holderUserId: string | null;
  successorName: string | null;
  successorUserId: string | null;
  handoffStatus: LeadershipHandoffStatus;
  targetHandoffDate: string | null;
  notes: string | null;
  seasonYear: number;
  createdAt: string;
  updatedAt: string;
};

export type LeadershipSummary = {
  totalRoles: number;
  withSuccessor: number;
  withoutSuccessor: number;
  byStatus: Array<{ status: LeadershipHandoffStatus; count: number }>;
  byCategory: Array<{ category: LeadershipCategory; count: number; withSuccessor: number }>;
  /** 0..1 signal blending successor coverage with handoff progress. */
  continuityScore: number;
};

export type LeadershipTier = "at_risk" | "developing" | "resilient";

export type LeadershipReadiness = {
  score: number;
  tier: LeadershipTier;
  coverage: number;
  progress: number;
  rolesAtRisk: string[];
  recommendations: string[];
};
