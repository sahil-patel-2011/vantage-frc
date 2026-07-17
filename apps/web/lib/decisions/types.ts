// Decision Log (ADR) domain types. Pure data shapes — no I/O, no framework imports.
// An engineering/strategy decision record: the context, the options considered, the call, and
// the rationale — the institutional memory judges love and next season's team needs. Distinct
// from an engineering change log (what changed) — this captures WHY.

export type DecisionCategory = "design" | "strategy" | "build" | "business" | "process" | "other";

export type DecisionStatus = "proposed" | "accepted" | "rejected" | "superseded";

export type DecisionRecord = {
  id: string;
  title: string;
  category: DecisionCategory;
  status: DecisionStatus;
  context: string | null;
  decision: string | null;
  rationale: string | null;
  /** Alternatives that were considered. */
  options: string[];
  /** ISO date (YYYY-MM-DD) the decision was made, or null. */
  decidedOn: string | null;
  deciders: string | null;
  /** id of an earlier decision this one replaces, or null. */
  supersedesId: string | null;
  notes: string | null;
  seasonYear: number;
  /** ISO timestamp — used only for stable ordering. */
  createdAt: string;
};

export type ResolvedDecision = DecisionRecord & {
  /** id of a later accepted decision that supersedes this one, or null. */
  supersededById: string | null;
  supersededByTitle: string | null;
  /** status after applying supersession (an accepted-but-replaced record reads "superseded"). */
  effectiveStatus: DecisionStatus;
};

export type DecisionsSummary = {
  total: number;
  byStatus: Record<DecisionStatus, number>;
  byCategory: Array<{ category: DecisionCategory; count: number }>;
  /** Proposed decisions still awaiting a call, oldest first. */
  open: ResolvedDecision[];
  /** Accepted/rejected decisions, most recently decided first. */
  recent: ResolvedDecision[];
  supersededCount: number;
};
