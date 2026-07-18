// Design Review domain types. Pure data shapes — no I/O, no framework imports.
// A gate review for a subsystem: a checklist of criteria, each with a verdict, some flagged as
// go/no-go blockers. The app derives readiness and a gate decision (go / conditional / no-go).

export type ReviewStage = "concept" | "preliminary" | "critical" | "final";
export type ReviewStatus = "scheduled" | "in_review" | "complete" | "cancelled";
export type ItemVerdict = "pending" | "pass" | "fail" | "na";
export type GateDecision = "go" | "conditional" | "no_go" | "pending";

export type ReviewItem = {
  id: string;
  criterion: string;
  verdict: ItemVerdict;
  /** A failed blocker forces a no-go. */
  blocking: boolean;
  notes: string | null;
};

export type DesignReview = {
  id: string;
  title: string;
  subsystem: string;
  stage: ReviewStage;
  status: ReviewStatus;
  scheduledOn: string | null;
  reviewers: string | null;
  items: ReviewItem[];
  notes: string | null;
  seasonYear: number;
  createdAt: string;
};

export type ReviewEvaluation = {
  review: DesignReview;
  applicable: number;
  passed: number;
  failed: number;
  pending: number;
  na: number;
  blockingFails: number;
  /** passed / applicable (0..1). */
  readiness: number;
  gate: GateDecision;
};

export type ReviewsSummary = {
  total: number;
  byStage: Record<ReviewStage, number>;
  byGate: Record<GateDecision, number>;
  /** Reviews with a no-go or pending gate, most at-risk first. */
  needsAttention: ReviewEvaluation[];
  /** Scheduled/in-review, by date. */
  upcoming: ReviewEvaluation[];
  avgReadiness: number;
};
