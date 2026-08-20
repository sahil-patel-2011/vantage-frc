import type { ItemVerdict, ReviewStage, ReviewStatus } from "./types";

export * from "./types";
export {
  evaluateReview,
  gateLabel,
  reviewStageLabel,
  reviewStatusLabel,
  stageBlueprint,
  summarizeReviews,
} from "./evaluate";

export const REVIEW_STAGES: ReviewStage[] = ["concept", "preliminary", "critical", "final"];
export const REVIEW_STATUSES: ReviewStatus[] = ["scheduled", "in_review", "complete", "cancelled"];
export const ITEM_VERDICTS: ItemVerdict[] = ["pending", "pass", "fail", "na"];
