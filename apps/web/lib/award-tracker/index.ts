// Award Tracker rollups. Pure aggregation over loaded submissions — deterministic given its
// input (plus an explicit `today` for overdue/due-soon math, no ambient clock).

import type { AwardSubmission, AwardSubmissionStatus, AwardTrackerSummary, AwardType } from "./types";

export * from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const AWARD_TYPES: AwardType[] = [
  "chairmans",
  "impact",
  "engineering_inspiration",
  "woodie_flowers",
  "dean_list",
  "rookie_all_star",
  "entrepreneurship",
  "quality",
  "innovation_in_control",
  "excellence_in_engineering",
  "imagery",
  "safety",
  "other",
];

export const AWARD_SUBMISSION_STATUSES: AwardSubmissionStatus[] = [
  "planning",
  "drafting",
  "submitted",
  "judging",
  "won",
  "not_won",
  "withdrawn",
];

const OPEN_STATUSES: AwardSubmissionStatus[] = ["planning", "drafting", "submitted", "judging"];

export function awardTypeLabel(type: AwardType): string {
  const labels: Record<AwardType, string> = {
    chairmans: "Chairman's Award",
    impact: "Impact Award",
    engineering_inspiration: "Engineering Inspiration",
    woodie_flowers: "Woodie Flowers Award",
    dean_list: "Dean's List",
    rookie_all_star: "Rookie All Star",
    entrepreneurship: "Entrepreneurship Award",
    quality: "Quality Award",
    innovation_in_control: "Innovation in Control Award",
    excellence_in_engineering: "Excellence in Engineering",
    imagery: "Imagery Award",
    safety: "Safety Award",
    other: "Other award",
  };
  return labels[type];
}

export function awardStatusLabel(status: AwardSubmissionStatus): string {
  const labels: Record<AwardSubmissionStatus, string> = {
    planning: "Planning",
    drafting: "Drafting",
    submitted: "Submitted",
    judging: "In judging",
    won: "Won",
    not_won: "Not won",
    withdrawn: "Withdrawn",
  };
  return labels[status];
}

/** Days until (positive) or since (negative) an ISO date, relative to `today`. Null if no date. */
export function daysUntil(iso: string | null, today: Date): number | null {
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffMs = target.getTime() - base.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Aggregate award submissions into status counts and a 0..1 progress signal: the share of
 * submissions that have moved past planning (drafting or further). Overdue/due-soon are
 * computed only for open submissions with a deadline still in front of them.
 */
export function summarizeAwardTracker(
  submissions: AwardSubmission[],
  today: Date = new Date(),
): AwardTrackerSummary {
  const statusMap = new Map<AwardSubmissionStatus, number>();
  let overdueCount = 0;
  let dueSoonCount = 0;
  let wonCount = 0;
  let submittedCount = 0;

  for (const submission of submissions) {
    statusMap.set(submission.status, (statusMap.get(submission.status) ?? 0) + 1);
    if (submission.status === "won") wonCount += 1;
    if (submission.status === "submitted" || submission.status === "judging") submittedCount += 1;

    if (OPEN_STATUSES.includes(submission.status) && submission.status !== "submitted" && submission.status !== "judging") {
      const days = daysUntil(submission.submissionDeadline, today);
      if (days != null) {
        if (days < 0) overdueCount += 1;
        else if (days <= 7) dueSoonCount += 1;
      }
    }
  }

  const byStatus = AWARD_SUBMISSION_STATUSES.filter((status) => statusMap.has(status)).map((status) => ({
    status,
    count: statusMap.get(status) ?? 0,
  }));

  const total = submissions.length;
  const movedPast = submissions.filter((s) => s.status !== "planning").length;
  const progressSignal = total > 0 ? clamp01(movedPast / total) : 0;

  return {
    total,
    byStatus,
    overdueCount,
    dueSoonCount,
    wonCount,
    submittedCount,
    progressSignal,
  };
}

/** Submissions sorted by nearest upcoming deadline first; undated/closed submissions sort last. */
export function upcomingDeadlines(submissions: AwardSubmission[], today: Date = new Date()): AwardSubmission[] {
  const rank = (s: AwardSubmission): number => {
    if (s.status === "won" || s.status === "not_won" || s.status === "withdrawn") return Number.MAX_SAFE_INTEGER;
    const days = daysUntil(s.submissionDeadline, today);
    return days == null ? Number.MAX_SAFE_INTEGER - 1 : days;
  };
  return [...submissions].sort((a, b) => rank(a) - rank(b));
}
