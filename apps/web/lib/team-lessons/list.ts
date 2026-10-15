/**
 * How the list page groups drafts. Client-safe and pure.
 *
 * A draft nobody has touched for a month and that still has no steps and no questions is
 * almost always one that was started and forgotten; those fold under "Old drafts" so the
 * drafts someone is actually writing stay at the top.
 */

import type { LessonSummary } from "./types";

export const OLD_DRAFT_DAYS = 30;

export function isOldEmptyDraft(lesson: LessonSummary, now = Date.now()): boolean {
  if (lesson.status !== "draft" || lesson.source !== "editor") return false;
  if (lesson.stepCount > 0 || lesson.questionCount > 0) return false;
  const at = Date.parse(lesson.updatedAt);
  return Number.isFinite(at) && now - at > OLD_DRAFT_DAYS * 86_400_000;
}

/** Drafts (and archived lessons) in their order, with the old empty drafts split off. */
export function splitDrafts(drafts: LessonSummary[], now = Date.now()): { current: LessonSummary[]; old: LessonSummary[] } {
  const current: LessonSummary[] = [];
  const old: LessonSummary[] = [];
  for (const lesson of drafts) (isOldEmptyDraft(lesson, now) ? old : current).push(lesson);
  return { current, old };
}

/** What "Discard draft" will delete, for its confirmation. */
export function discardDraftBody(lesson: Pick<LessonSummary, "source" | "stepCount" | "questionCount">): string {
  const parts: string[] = [];
  if (lesson.source === "pdf") parts.push("the link to its PDF (the file stays in your team's Files)");
  else if (lesson.stepCount) parts.push(`${lesson.stepCount} step${lesson.stepCount === 1 ? "" : "s"}`);
  if (lesson.questionCount) parts.push(`${lesson.questionCount} practice question${lesson.questionCount === 1 ? "" : "s"}`);
  if (!parts.length) return "It has nothing written in it yet. This can't be undone.";
  return `Its ${parts.join(" and ")} and its history are deleted. This can't be undone.`;
}
