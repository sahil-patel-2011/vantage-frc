/**
 * The lifecycle of a graduation exit interview: draft -> submitted -> published to the wiki.
 *
 * Before this, `log-response` only ever inserted. A senior who saved a draft in April had no way
 * to finish it in May, and a draft never produced the handoff wiki page — the whole point of
 * capturing the interview. These are the pure rules for who may move a record and when the wiki
 * page gets written, kept separate from the SQL so they can be tested and so every entry point
 * (mentor form, self-service link) agrees.
 *
 * The governing idea: a *draft* belongs to whoever is writing it, a *submitted* record is team
 * history. History is mentor-managed, and it is published exactly once.
 */

import type { ExitInterviewStatus } from "./types";

export class ExitInterviewError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 = 403,
  ) {
    super(message);
    this.name = "ExitInterviewError";
  }
}

const isMentor = (role: string | null | undefined) => role === "owner" || role === "admin";

export type ResponseActor = {
  role: string | null | undefined;
  userId: string;
};

export type ResponseSubject = {
  status: ExitInterviewStatus;
  /** The member who filed the record. */
  submittedBy: string;
  /** The graduating member the record is about, once resolved to a roster user. */
  memberUserId: string | null;
};

/** Drafts belong to their author and to mentors; a submitted record is mentor-managed. */
export function canEditResponse(actor: ResponseActor, subject: ResponseSubject): boolean {
  if (isMentor(actor.role)) return true;
  if (subject.status !== "draft") return false;
  return subject.submittedBy === actor.userId || subject.memberUserId === actor.userId;
}

export function assertCanEditResponse(actor: ResponseActor, subject: ResponseSubject): void {
  if (canEditResponse(actor, subject)) return;
  throw new ExitInterviewError(
    subject.status === "draft"
      ? "You can only edit your own exit interview draft."
      : "A submitted exit interview can only be changed by an owner or admin.",
  );
}

/**
 * Deleting is always a mentor action, including on your own record. A submitted interview is part
 * of the team's handoff history, and letting the author delete it would let them take the record
 * with them on the way out.
 */
export function assertCanDeleteResponse(actor: ResponseActor): void {
  if (isMentor(actor.role)) return;
  throw new ExitInterviewError("Only an owner or admin can delete an exit interview.");
}

/**
 * The allowed transitions. Submitting is one-way: unsubmitting would orphan a published wiki page
 * that teammates may already have linked to.
 */
export function nextStatus(
  current: ExitInterviewStatus,
  requested: ExitInterviewStatus | null | undefined,
): ExitInterviewStatus {
  if (!requested || requested === current) return current;
  if (current === "draft" && requested === "submitted") return "submitted";
  throw new ExitInterviewError(
    "A submitted exit interview cannot be moved back to a draft.",
    409,
  );
}

/**
 * Whether this transition should write the handoff wiki page. Publishing happens on the move into
 * `submitted`, and only if a page was not already written — re-saving a submitted record must not
 * pile up duplicate pages in the team wiki.
 */
export function shouldPublishWiki(input: {
  previousStatus: ExitInterviewStatus;
  nextStatus: ExitInterviewStatus;
  existingPageId: string | null;
}): boolean {
  if (input.nextStatus !== "submitted") return false;
  if (input.existingPageId) return false;
  return input.previousStatus === "draft" || input.previousStatus === "submitted";
}

/** A record with nothing written in it has no handoff value; the UI should say so before submit. */
export function hasHandoffContent(input: {
  highlights: string | null;
  adviceForFuture: string | null;
  skillsToDocument: string | null;
}): boolean {
  return Boolean(
    input.highlights?.trim() || input.adviceForFuture?.trim() || input.skillsToDocument?.trim(),
  );
}
