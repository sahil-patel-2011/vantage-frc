// Award Tracker domain types. Pure data shapes — no I/O, no framework imports.
// Tracks award SUBMISSIONS (Chairman's, Impact, Engineering Inspiration, etc.) across events
// with deadlines — the workflow record, distinct from the community-impact evidence log
// (apps/web/lib/impact) which substantiates the narrative content of those submissions.

export type AwardType =
  | "chairmans"
  | "impact"
  | "engineering_inspiration"
  | "woodie_flowers"
  | "dean_list"
  | "rookie_all_star"
  | "entrepreneurship"
  | "quality"
  | "innovation_in_control"
  | "excellence_in_engineering"
  | "imagery"
  | "safety"
  | "other";

export type AwardSubmissionStatus =
  | "planning"
  | "drafting"
  | "submitted"
  | "judging"
  | "won"
  | "not_won"
  | "withdrawn";

export type AwardSubmission = {
  id: string;
  awardType: AwardType;
  awardName: string;
  eventName: string;
  eventDate: string | null;
  submissionDeadline: string | null;
  status: AwardSubmissionStatus;
  submittedOn: string | null;
  ownerNote: string | null;
  notes: string | null;
  seasonYear: number;
};

export type AwardTrackerSummary = {
  total: number;
  byStatus: Array<{ status: AwardSubmissionStatus; count: number }>;
  overdueCount: number;
  dueSoonCount: number;
  wonCount: number;
  submittedCount: number;
  /** 0..1 signal: share of submissions that have moved past planning. */
  progressSignal: number;
};
