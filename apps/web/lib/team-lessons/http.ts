/**
 * Shared plumbing for /api/team-lessons routes: session, team id, the request body, and one
 * failure shape. Server-only.
 */

import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { z } from "zod";
import { parseSecureJson, RequestSecurityError } from "../security/request";
import { publicErrorMessage, viewOnlyResponse } from "../security/public-error";
import { isDatabaseUnavailable, isLessonsSchemaMissing, LessonHttpError, LESSONS_SETUP_MESSAGE } from "./store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A lesson with 40 full steps is about 600 000 characters; leave room for UTF-8. */
export const LESSON_BODY_MAX_BYTES = 2_000_000;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The team id from a query string or body: required, and a UUID before it reaches `$n::uuid`. */
export function requireOrgId(value: unknown): string {
  const orgId = typeof value === "string" ? value.trim() : "";
  if (!orgId) throw new LessonHttpError(400, "Choose your team first.");
  if (!isUuid(orgId)) throw new LessonHttpError(400, "That isn't a valid team. Choose your team again.");
  return orgId;
}

export function requireLessonId(value: unknown): string {
  if (!isUuid(value)) throw new LessonHttpError(404, "That lesson doesn't exist.");
  return value;
}

export async function requireLessonSession(): Promise<{ userId: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new LessonHttpError(401, "Your session ended. Sign in again.");
  return { userId: session.user.id };
}

/** A same-origin JSON body (content type, origin and size checked), as a plain object. */
export async function readLessonJson(request: Request, maxBytes = 65_536): Promise<Record<string, unknown>> {
  return parseSecureJson(request, z.record(z.string(), z.unknown()), { maxBytes });
}

export function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
}

/** Every failure as `{ error }` (plus any detail the page needs), never a database message. */
export function lessonErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof LessonHttpError) return privateJson({ error: error.message, ...error.extra }, error.status);
  if (error instanceof RequestSecurityError) return privateJson({ error: error.message }, error.status);
  const viewOnly = viewOnlyResponse(error);
  if (viewOnly) return viewOnly;
  if (isLessonsSchemaMissing(error) || isDatabaseUnavailable(error)) {
    return privateJson({ status: "setup_required", error: LESSONS_SETUP_MESSAGE }, 503);
  }
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  // Row security refused a write the role checks allowed: the person's role changed mid-request.
  if (code === "42501") return privateJson({ error: "Your access to this lesson changed. Reload and try again." }, 403);
  return privateJson({ error: publicErrorMessage(error, fallback) }, 500);
}
