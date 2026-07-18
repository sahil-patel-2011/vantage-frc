// CAD Review Queue domain types. Pure data shapes — no I/O, no framework imports.
// A checkpoint review queue for CAD parts/assemblies: items move through design
// checkpoints and accumulate reviewer sign-offs before being released to manufacture.

export type CadReviewCheckpoint = "design_review" | "fit_check" | "manufacturing_ready";

export type CadReviewStatus = "pending" | "changes_requested" | "approved" | "released";

export type CadReviewPriority = "low" | "normal" | "high" | "urgent";

export type CadReviewDecision = "approved" | "changes_requested";

export type CadReviewSignoff = {
  id: string;
  reviewerId: string;
  decision: CadReviewDecision;
  comment: string | null;
  createdAt: string;
};

export type CadReviewItem = {
  id: string;
  partName: string;
  description: string | null;
  checkpoint: CadReviewCheckpoint;
  status: CadReviewStatus;
  cadLink: string | null;
  priority: CadReviewPriority;
  submittedBy: string;
  requiredSignoffs: number;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  signoffs: CadReviewSignoff[];
};

export type CadReviewSummary = {
  totalItems: number;
  pendingCount: number;
  changesRequestedCount: number;
  approvedCount: number;
  releasedCount: number;
  readyForManufactureCount: number;
  byCheckpoint: Array<{ checkpoint: CadReviewCheckpoint; count: number }>;
  byPriority: Array<{ priority: CadReviewPriority; count: number }>;
};
