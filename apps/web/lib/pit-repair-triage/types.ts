// Predictive pit-repair triage domain types. Pure data shapes — no I/O, no framework imports.
// A failure is logged (note/photo) and cross-referenced against FMEA failure history for the
// same subsystem, spares on hand, and minutes until the next match to decide fix-vs-swap and
// whether to pre-stage a spare part.

export type TriageDecision = "fix" | "swap" | "monitor";

export type TriageStatus = "open" | "staged" | "resolved";

/** Delete matches pit_repair_triage_reports RLS: the member who logged the report, or an owner or admin. */
export function canDeletePitRepairReport(input: {
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

/** Deterministic triage recommendation, grounded only in the supplied inputs. */
export type TriageResult = {
  decision: TriageDecision;
  confidence: number;
  rationale: string;
  prestageRecommended: boolean;
};

/** A related FMEA failure record, read from the existing fmea_failures table (read-only join). */
export type FmeaHistoryEntry = {
  id: string;
  title: string;
  subsystemName: string;
  occurredAt: string;
  severity: number;
  occurrence: number;
  detection: number;
  status: string;
};

/** A spare-part candidate, read from the existing inventory_items table (read-only join). */
export type SpareCandidate = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  subsystem: string | null;
};

export type TriageReport = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  title: string;
  symptomNote: string;
  photoUrl: string | null;
  relatedFmeaFailureId: string | null;
  matchedInventoryItemId: string | null;
  minutesUntilNextMatch: number;
  severity: number;
  priorFailureCount: number;
  sparesAvailable: number;
  decision: TriageDecision;
  confidence: number;
  rationale: string;
  prestageRecommended: boolean;
  status: TriageStatus;
  recordedBy?: string;
  createdAt: string;
  updatedAt: string;
};
