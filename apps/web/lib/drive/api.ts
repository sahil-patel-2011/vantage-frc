/**
 * Shared plumbing for the /api/drive routes: session, membership, and the one
 * honest failure shape. Kept in one place so every Drive route answers a
 * missing database with `setup_required` rather than a 500, and answers a
 * wrong org with the same 403 sentence.
 *
 * Server-only.
 */

import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { resolveDriveMembership, type DriveMembership } from "./store";
import type { PoolClient } from "@neondatabase/serverless";

export class DriveHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type DriveSession = { userId: string; email: string; name: string };

export async function requireDriveSession(): Promise<DriveSession> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new DriveHttpError(401, "Authentication required");
  return {
    userId: session.user.id,
    // The session's own address — never a value from the request body. This is
    // what "Shared with me" matches on.
    email: (session.user.email ?? "").trim().toLowerCase(),
    name: session.user.name ?? "",
  };
}

export async function requireDriveMembership(
  client: PoolClient,
  userId: string,
  requestedOrgId: string | null,
): Promise<DriveMembership> {
  const membership = await resolveDriveMembership(client, userId, requestedOrgId);
  if (!membership) throw new DriveHttpError(403, "You are not a member of this team's workspace.");
  return membership;
}

/**
 * Product routes need a real database. Without one they must report
 * `setup_required` rather than crashing — CLAUDE.md's rule, and the difference
 * between "Vantage is broken" and "this deployment has no DATABASE_URL yet".
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /DATABASE_URL|DATABASE_AUTH_URL/i.test(message) ||
    /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated|timeout expired/i.test(message)
  );
}

export function driveErrorResponse(error: unknown): Response {
  if (error instanceof DriveHttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (isDatabaseUnavailable(error)) {
    return Response.json(
      {
        status: "setup_required",
        reason: "Vantage Drive needs a database connection. Set DATABASE_URL for this deployment.",
      },
      { status: 200 },
    );
  }
  const message = error instanceof Error ? error.message : "The request could not be completed";
  return Response.json({ error: message }, { status: 400 });
}

/** Read a trimmed, length-capped string from an untrusted body/query. */
export function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only pass a real UUID into a `$n::uuid` cast — a bad one is a 22P02, not a 400. */
export function readUuid(value: unknown): string | null {
  const text = readString(value, 64);
  return text && UUID.test(text) ? text : null;
}
