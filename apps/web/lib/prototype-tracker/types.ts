// Prototype-to-decision tracker domain types. Pure data shapes — no I/O, no framework imports.
// A prototype test (hypothesis, result, metric vs. target) is logged and linked to a design
// decision. The decision record + notebook entry are drafted deterministically, grounded only
// in the linked test's own recorded fields — never fabricated.

export type TestOutcome = "success" | "failure" | "inconclusive" | "partial";

export type DecisionRecommendation = "adopt" | "iterate" | "reject" | "needs_more_data";

export type DecisionStatus = "draft" | "finalized";

export function canDeletePrototypeRow(input: {
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

export type PrototypeTest = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  title: string;
  hypothesis: string;
  testDate: string;
  outcome: TestOutcome;
  resultSummary: string;
  metricLabel: string | null;
  metricValue: number | null;
  metricTarget: number | null;
  loggedBy?: string;
  createdAt: string;
};

/** Deterministic recommendation, grounded only in the supplied test's outcome + metric. */
export type DecisionDraft = {
  recommendation: DecisionRecommendation;
  confidence: number;
  decisionRecord: string;
  notebookEntry: string;
};

export type PrototypeDecision = {
  id: string;
  testId: string;
  decisionTitle: string;
  recommendation: DecisionRecommendation;
  confidence: number;
  decisionRecord: string;
  notebookEntry: string;
  status: DecisionStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};
