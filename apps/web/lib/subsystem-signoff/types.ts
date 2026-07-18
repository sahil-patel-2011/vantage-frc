// Subsystem sign-off domain types. Pure data shapes — no I/O, no framework imports.
// Each robot subsystem must clear a fixed set of review gates before it is competition-ready.
// A sign-off record is one reviewer's approve/reject decision on one gate; readiness is derived
// only from recorded decisions — never fabricated.

export type SubsystemCategory =
  | "drivetrain"
  | "intake"
  | "scoring"
  | "climber"
  | "electrical"
  | "software"
  | "other";

export type SubsystemStatus = "in_progress" | "ready_for_review" | "signed_off" | "blocked";

/** The fixed review gates a subsystem clears on its way to competition-ready. */
export type SignoffGate =
  | "design"
  | "fabrication"
  | "assembly"
  | "wiring"
  | "programming"
  | "field_test";

export type SignoffDecision = "approved" | "rejected";

export type Subsystem = {
  id: string;
  name: string;
  category: SubsystemCategory;
  status: SubsystemStatus;
  notes: string | null;
  seasonYear: number;
};

/** One reviewer's decision on one gate for one subsystem, captured on a date. */
export type SignoffRecord = {
  id: string;
  subsystemId: string;
  gate: SignoffGate;
  decision: SignoffDecision;
  reviewerId: string;
  signedOn: string;
  notes: string | null;
};

/** Per-gate state for a subsystem, resolved from the latest decision on that gate. */
export type GateState = {
  gate: SignoffGate;
  decision: SignoffDecision | null;
  signedOn: string | null;
};

export type SubsystemScore = {
  subsystemId: string;
  subsystem: Subsystem;
  gates: GateState[];
  approvedGates: number;
  rejectedGates: number;
  gatesTotal: number;
  fullyApproved: boolean;
  /** 0..1 fraction of required gates currently approved. */
  completion: number;
};

export type SubsystemSignoffSummary = {
  totalSubsystems: number;
  startedSubsystems: number;
  signedOffSubsystems: number;
  blockedSubsystems: number;
  totalGates: number;
  approvedGates: number;
  subsystemScores: SubsystemScore[];
};

export type SubsystemSignoffTier = "not_started" | "in_progress" | "ready";

export type SubsystemSignoffReadiness = {
  /** 0..1 overall competition-readiness signal derived from recorded gate approvals. */
  score: number;
  tier: SubsystemSignoffTier;
  subsystemsFullyApproved: number;
  recommendations: string[];
};
