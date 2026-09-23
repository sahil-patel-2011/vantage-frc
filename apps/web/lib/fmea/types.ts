// Structured FMEA / failure log. Score each failure Occurrence × Severity ×
// Detection (classic RPN), attach root cause + fix, and roll up by subsystem
// so "most failure-prone system" is queryable.

export type FmeaContext = "match" | "pit" | "practice" | "inspection" | "other";

export type FmeaStatus = "open" | "fixing" | "verified" | "closed";

/** Delete matches fmea_failures RLS: the member who logged the row, or an owner or admin. */
export function canDeleteFmeaFailure(input: {
  role?: string | null;
  userId?: string | null;
  authorId?: string | null;
}): boolean {
  const role = (input.role ?? "").toLowerCase();
  if (role === "owner" || role === "admin") return true;
  const userId = input.userId ?? "";
  const authorId = input.authorId ?? "";
  return userId.length > 0 && userId === authorId;
}

export type FmeaLevel = "low" | "moderate" | "high" | "critical";

export type FmeaFailure = {
  id: string;
  title: string;
  failureMode: string;
  context: FmeaContext;
  subsystemId: string | null;
  subsystemName: string;
  /** 1 (rare) … 10 (almost certain / chronic). */
  occurrence: number;
  /** 1 (negligible) … 10 (safety / total loss). */
  severity: number;
  /** 1 (always caught) … 10 (undetectable until it fails). */
  detection: number;
  rootCause: string | null;
  fiveWhys: string | null;
  fix: string | null;
  status: FmeaStatus;
  inspectionItemId: string | null;
  /** Optional spare-bin link (0512). Null falls back to subsystem-name matching. */
  inventoryItemId?: string | null;
  inventoryItemName?: string | null;
  eventKey: string | null;
  matchKey: string | null;
  robotLabel: string;
  /** ISO timestamp. */
  occurredAt: string;
  seasonYear: number;
  recordedBy?: string;
  recordedByName: string | null;
};

export type FmeaEvaluation = {
  failure: FmeaFailure;
  /** occurrence × severity × detection, 1..1000. */
  rpn: number;
  level: FmeaLevel;
  active: boolean;
  /** Open/fixing with no fix recorded. */
  needsFix: boolean;
};

export type SubsystemFailureProfile = {
  subsystemName: string;
  subsystemId: string | null;
  count: number;
  openCount: number;
  avgRpn: number;
  maxRpn: number;
  level: FmeaLevel;
};

export type FmeaSummary = {
  total: number;
  active: number;
  byLevel: Record<FmeaLevel, number>;
  byStatus: Record<FmeaStatus, number>;
  byContext: Array<{ context: FmeaContext; count: number }>;
  /** Subsystems ranked by failure count, then avg RPN. */
  bySubsystem: SubsystemFailureProfile[];
  /** Active failures, highest RPN first. */
  topFailures: FmeaEvaluation[];
  needsFix: FmeaEvaluation[];
  highestRpn: number;
  avgRpn: number;
};
