/**
 * Who may do what with a team lesson. The database enforces the same rules (0717's policies);
 * these mirror them so the API can answer with a plain sentence instead of "0 rows", and so
 * the page shows only the buttons that will work.
 */

import type { LessonRole, LessonStatus } from "./types";

export type LessonOwnership = { createdBy: string; status: LessonStatus };

export function asLessonRole(value: unknown): LessonRole | null {
  return value === "owner" || value === "admin" || value === "scout" || value === "viewer" ? value : null;
}

/** Owners and admins manage every lesson. */
export function canManageLessons(role: LessonRole): boolean {
  return role === "owner" || role === "admin";
}

/** Owners, admins and team members write lessons; View only members read them. */
export function canCreateLessons(role: LessonRole): boolean {
  return canManageLessons(role) || role === "scout";
}

/** Owners and admins edit any lesson; a team member edits their own draft. */
export function canEditLesson(role: LessonRole, userId: string, lesson: LessonOwnership): boolean {
  if (canManageLessons(role)) return true;
  return role === "scout" && lesson.createdBy === userId && lesson.status === "draft";
}

/** Whoever can edit a lesson that is not already published may publish it. */
export function canPublishLesson(role: LessonRole, userId: string, lesson: LessonOwnership): boolean {
  return lesson.status !== "published" && canEditLesson(role, userId, lesson);
}

/** Moving a lesson back to draft, or archiving it, is for owners and admins. */
export function canChangeLessonStatus(role: LessonRole): boolean {
  return canManageLessons(role);
}

/** Owners and admins delete any lesson; the author deletes their own draft. */
export function canDeleteLesson(role: LessonRole, userId: string, lesson: LessonOwnership): boolean {
  if (canManageLessons(role)) return true;
  return role !== "viewer" && lesson.createdBy === userId && lesson.status === "draft";
}

/** Why an edit was refused, for the 403 a person reads. */
export function editRefusal(role: LessonRole, userId: string, lesson: LessonOwnership): string {
  if (role === "viewer") return "View only members can take lessons but not change them.";
  if (lesson.createdBy !== userId) return "Only the person who wrote this lesson, or a team owner or admin, can change it.";
  if (lesson.status !== "draft") return "This lesson is published. Ask a team owner or admin to move it back to draft so you can change it.";
  return "You can't change this lesson.";
}
