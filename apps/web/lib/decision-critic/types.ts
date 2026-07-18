// Design-decision devil's-advocate domain types. Pure data shapes — no I/O, no framework imports.
// A design decision proposal is cross-referenced against weight/power headroom, FMEA failure
// history for the same subsystem, and prior decision outcomes (accepted vs rejected/superseded)
// to produce a grounded second opinion: proceed, proceed with caution, or reconsider.

export type DecisionCriticCategory = "design" | "strategy" | "build" | "process" | "other";

export type DecisionCriticVerdict = "proceed" | "proceed_with_caution" | "reconsider";

/** What the team actually did after reading the critique — feeds future grounding. */
export type DecisionCriticOutcome = "open" | "proceeded" | "revised" | "abandoned";

/** Deterministic critique result, grounded only in the supplied headroom/history inputs. */
export type CriticResult = {
  verdict: DecisionCriticVerdict;
  confidence: number;
  concerns: string[];
  recommendation: string;
};

/** A related FMEA failure record, read from the existing fmea_failures table (read-only join). */
export type FmeaMatch = {
  id: string;
  title: string;
  subsystemName: string;
  occurredAt: string;
  severity: number;
  occurrence: number;
  detection: number;
  status: string;
};

/** A related prior decision, read from the existing decision_records table (read-only join). */
export type PriorDecisionMatch = {
  id: string;
  title: string;
  status: string;
  decidedOn: string | null;
  rationale: string | null;
};

/** Robot weight budget headroom, read from weight_components / weight_settings (read-only join). */
export type WeightHeadroom = {
  totalLbs: number;
  limitLbs: number;
  marginLbs: number;
};

/** Robot power budget headroom, read from power_loads (read-only join). */
export type PowerHeadroom = {
  totalPeakAmps: number;
  totalBreakerAmps: number;
  headroomAmps: number;
};

export type DecisionCriticReview = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  title: string;
  proposal: string;
  category: DecisionCriticCategory;
  weightAddedLbs: number;
  weightMarginLbs: number;
  powerAddedAmps: number;
  powerHeadroomAmps: number;
  chronicFailureCount: number;
  priorRejectedCount: number;
  verdict: DecisionCriticVerdict;
  confidence: number;
  concerns: string[];
  recommendation: string;
  relatedFmeaFailureIds: string[];
  relatedDecisionIds: string[];
  outcome: DecisionCriticOutcome;
  createdAt: string;
  updatedAt: string;
};
