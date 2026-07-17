/** Shared readiness/deadline math for grant applications and award submissions. */
export type SubmissionItem = { content: string | null; charLimit: number | null; done: boolean };

export function essayStats(item: Pick<SubmissionItem, "content" | "charLimit">) {
  const chars = item.content?.length ?? 0;
  return {
    chars,
    overLimit: item.charLimit != null && chars > item.charLimit,
    remaining: item.charLimit != null ? item.charLimit - chars : null,
  };
}

export function submissionReadiness(items: SubmissionItem[]) {
  const totalItems = items.length;
  const doneItems = items.filter((item) => item.done || (item.content?.trim().length ?? 0) > 0).length;
  return {
    totalItems,
    doneItems,
    percentComplete: totalItems === 0 ? 0 : Math.round((doneItems / totalItems) * 100),
    readyToSubmit: totalItems > 0 && doneItems === totalItems,
  };
}

export function daysUntilDeadline(deadline: string | null, now = new Date()) {
  if (!deadline) return null;
  const diffMs = new Date(deadline).getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function isUrgent(deadline: string | null, thresholdDays = 14, now = new Date()) {
  const days = daysUntilDeadline(deadline, now);
  return days != null && days <= thresholdDays;
}
