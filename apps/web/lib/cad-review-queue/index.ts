// Pure helper functions for the CAD Review Queue — no I/O, unit-testable in isolation.

import type {
  CadReviewCheckpoint,
  CadReviewDecision,
  CadReviewItem,
  CadReviewPriority,
  CadReviewStatus,
  CadReviewSummary,
} from "./types";

export const CAD_REVIEW_CHECKPOINTS: CadReviewCheckpoint[] = [
  "design_review",
  "fit_check",
  "manufacturing_ready",
];

export const CAD_REVIEW_STATUSES: CadReviewStatus[] = [
  "pending",
  "changes_requested",
  "approved",
  "released",
];

export const CAD_REVIEW_PRIORITIES: CadReviewPriority[] = ["low", "normal", "high", "urgent"];

export const CAD_REVIEW_DECISIONS: CadReviewDecision[] = ["approved", "changes_requested"];

export function cadReviewCheckpointLabel(checkpoint: CadReviewCheckpoint): string {
  switch (checkpoint) {
    case "design_review":
      return "Design review";
    case "fit_check":
      return "Fit check";
    case "manufacturing_ready":
      return "Manufacturing ready";
    default:
      return checkpoint;
  }
}

export function cadReviewStatusLabel(status: CadReviewStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "changes_requested":
      return "Changes requested";
    case "approved":
      return "Approved";
    case "released":
      return "Released";
    default:
      return status;
  }
}

export function cadReviewPriorityLabel(priority: CadReviewPriority): string {
  switch (priority) {
    case "low":
      return "Low";
    case "normal":
      return "Normal";
    case "high":
      return "High";
    case "urgent":
      return "Urgent";
    default:
      return priority;
  }
}

/** Fraction (0..1) of the required sign-offs an item has accumulated from approving reviewers. */
export function signoffProgress(item: Pick<CadReviewItem, "signoffs" | "requiredSignoffs">): number {
  if (item.requiredSignoffs <= 0) return 0;
  const approvals = item.signoffs.filter((s) => s.decision === "approved").length;
  return Math.min(1, approvals / item.requiredSignoffs);
}

/** True once an item has accumulated enough approving sign-offs and has no outstanding changes-requested. */
export function isReadyForManufacture(item: Pick<CadReviewItem, "signoffs" | "requiredSignoffs" | "status">): boolean {
  if (item.status === "released") return true;
  const approvals = item.signoffs.filter((s) => s.decision === "approved").length;
  const hasOpenChangeRequest = item.signoffs.length > 0 && item.signoffs[0]?.decision === "changes_requested";
  return approvals >= item.requiredSignoffs && !hasOpenChangeRequest;
}

export function summarizeCadReviewQueue(items: CadReviewItem[]): CadReviewSummary {
  const byCheckpoint = CAD_REVIEW_CHECKPOINTS.map((checkpoint) => ({
    checkpoint,
    count: items.filter((item) => item.checkpoint === checkpoint).length,
  }));
  const byPriority = CAD_REVIEW_PRIORITIES.map((priority) => ({
    priority,
    count: items.filter((item) => item.priority === priority).length,
  }));

  return {
    totalItems: items.length,
    pendingCount: items.filter((item) => item.status === "pending").length,
    changesRequestedCount: items.filter((item) => item.status === "changes_requested").length,
    approvedCount: items.filter((item) => item.status === "approved").length,
    releasedCount: items.filter((item) => item.status === "released").length,
    readyForManufactureCount: items.filter((item) => isReadyForManufacture(item)).length,
    byCheckpoint,
    byPriority,
  };
}
