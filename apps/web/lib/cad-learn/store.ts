import type { PoolClient } from "@neondatabase/serverless";
import type { PartMassProperties } from "@vantage/cad";

/**
 * Data access for the CAD learning track.
 *
 * Every query here runs on a `PoolClient` handed down from `withRls`, so the
 * RLS policies in migration 0613 are the real guard. The org is always resolved
 * from the caller's OWN membership and is never taken from a request body —
 * there is no "which team" parameter anywhere in this feature to forge.
 *
 * The second layer (an explicit `org_id = $n::uuid` on every statement) is the
 * belt-and-braces CLAUDE.md asks for, not the security boundary.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Membership = {
  orgId: string;
  orgName: string;
  role: string;
};

/** Owners and admins — the leads and mentors, matching 0611's bar. */
export function isLead(membership: Membership): boolean {
  return membership.role === "owner" || membership.role === "admin";
}

export async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrgId: string | null = null,
): Promise<Membership> {
  const result = await client.query<Membership>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY o.name
      LIMIT 1`,
    [userId, requestedOrgId],
  );
  const membership = result.rows[0];
  if (!membership) throw new HttpError(403, "Organization membership required");
  return membership;
}

export type LessonProgressRow = {
  lessonId: string;
  viewedAt: string;
  completedAt: string | null;
};

export async function readMyProgress(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<LessonProgressRow[]> {
  const result = await client.query<LessonProgressRow>(
    `SELECT lesson_id AS "lessonId",
            viewed_at::text AS "viewedAt",
            completed_at::text AS "completedAt"
       FROM cad_learn_progress
      WHERE org_id = $1::uuid AND user_id = $2::uuid
      ORDER BY lesson_id`,
    [orgId, userId],
  );
  return result.rows;
}

export type TeamProgressRow = {
  userId: string;
  displayName: string;
  viewed: number;
  completed: number;
  lastActivityAt: string | null;
  gradedBest: string | null;
};

/**
 * The mentor view: one row per member who has started the track.
 *
 * RLS already restricts the underlying rows to the caller's own unless they are
 * a lead, so a student calling this legitimately sees only themselves. The
 * route still checks `isLead` before showing it as a roster, because "here is
 * the team, and it is just you" reads as a broken page rather than as a
 * permission boundary.
 */
export async function readTeamProgress(client: PoolClient, orgId: string): Promise<TeamProgressRow[]> {
  const result = await client.query<TeamProgressRow>(
    `SELECT p.user_id AS "userId",
            COALESCE(NULLIF(btrim(u.name), ''), u.email) AS "displayName",
            count(*)::int AS "viewed",
            count(p.completed_at)::int AS "completed",
            max(p.updated_at)::text AS "lastActivityAt",
            (
              SELECT s.overall_band
                FROM cad_learn_submissions s
               WHERE s.org_id = $1::uuid AND s.user_id = p.user_id
               ORDER BY CASE s.overall_band WHEN 'match' THEN 0 WHEN 'close' THEN 1 ELSE 2 END,
                        s.graded_at DESC
               LIMIT 1
            ) AS "gradedBest"
       FROM cad_learn_progress p
       JOIN users u ON u.id = p.user_id
      WHERE p.org_id = $1::uuid
      GROUP BY p.user_id, u.name, u.email
      ORDER BY "displayName"`,
    [orgId],
  );
  return result.rows;
}

/**
 * Record that a student opened, finished, or reopened a lesson.
 *
 * `user_id` is the session's own id, never a parameter — the RLS policy
 * re-checks that too, so marking someone else's lesson complete is impossible
 * at both layers.
 */
export async function markProgress(
  client: PoolClient,
  input: { orgId: string; userId: string; lessonId: string; completed: boolean },
): Promise<LessonProgressRow> {
  const result = await client.query<LessonProgressRow>(
    `INSERT INTO cad_learn_progress (org_id, user_id, lesson_id, viewed_at, completed_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, now(), CASE WHEN $4::boolean THEN now() ELSE NULL END, now())
     ON CONFLICT (org_id, user_id, lesson_id) DO UPDATE
       SET completed_at = CASE
             WHEN $4::boolean THEN COALESCE(cad_learn_progress.completed_at, now())
             ELSE NULL
           END,
           updated_at = now()
     RETURNING lesson_id AS "lessonId", viewed_at::text AS "viewedAt", completed_at::text AS "completedAt"`,
    [input.orgId, input.userId, input.lessonId, input.completed],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(400, "Could not record that");
  return row;
}

export type ReferencePartRow = {
  lessonId: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  massKg: number;
  volumeM3: number | null;
  principalInertia: number[] | null;
  material: string;
  measuredAt: string;
  measuredByName: string | null;
};

export async function readReferenceParts(client: PoolClient, orgId: string): Promise<ReferencePartRow[]> {
  const result = await client.query<ReferencePartRow>(
    `SELECT r.lesson_id AS "lessonId",
            r.onshape_document_id AS "documentId",
            r.onshape_workspace_id AS "workspaceId",
            r.onshape_element_id AS "elementId",
            r.mass_kg AS "massKg",
            r.volume_m3 AS "volumeM3",
            r.principal_inertia_kg_m2 AS "principalInertia",
            r.material,
            r.measured_at::text AS "measuredAt",
            COALESCE(NULLIF(btrim(u.name), ''), u.email) AS "measuredByName"
       FROM cad_learn_reference_parts r
       LEFT JOIN users u ON u.id = r.measured_by
      WHERE r.org_id = $1::uuid
      ORDER BY r.lesson_id`,
    [orgId],
  );
  return result.rows;
}

export async function readReferenceForLesson(
  client: PoolClient,
  orgId: string,
  lessonId: string,
): Promise<ReferencePartRow | null> {
  const result = await client.query<ReferencePartRow>(
    `SELECT lesson_id AS "lessonId",
            onshape_document_id AS "documentId",
            onshape_workspace_id AS "workspaceId",
            onshape_element_id AS "elementId",
            mass_kg AS "massKg",
            volume_m3 AS "volumeM3",
            principal_inertia_kg_m2 AS "principalInertia",
            material,
            measured_at::text AS "measuredAt",
            NULL AS "measuredByName"
       FROM cad_learn_reference_parts
      WHERE org_id = $1::uuid AND lesson_id = $2
      LIMIT 1`,
    [orgId, lessonId],
  );
  return result.rows[0] ?? null;
}

/** A stored reference row, back in the shape the grader compares. */
export function referenceAsMassProperties(row: ReferencePartRow): PartMassProperties {
  const inertia =
    Array.isArray(row.principalInertia) && row.principalInertia.length === 3
      ? ([row.principalInertia[0]!, row.principalInertia[1]!, row.principalInertia[2]!] as [number, number, number])
      : null;
  return {
    massKg: Number(row.massKg),
    volumeM3: row.volumeM3 === null ? null : Number(row.volumeM3),
    principalInertiaKgM2: inertia,
    densityKgM3: row.volumeM3 ? Number(row.massKg) / Number(row.volumeM3) : null,
    bodyKey: "-all-",
    microversionId: null,
  };
}

export async function upsertReferencePart(
  client: PoolClient,
  input: {
    orgId: string;
    lessonId: string;
    userId: string;
    documentId: string;
    workspaceId: string;
    elementId: string;
    material: string;
    measured: PartMassProperties;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO cad_learn_reference_parts
       (org_id, lesson_id, onshape_document_id, onshape_workspace_id, onshape_element_id,
        mass_kg, volume_m3, principal_inertia_kg_m2, material, onshape_microversion_id,
        measured_at, measured_by, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::double precision, $7::double precision,
             $8::double precision[], $9, $10, now(), $11::uuid, now())
     ON CONFLICT (org_id, lesson_id) DO UPDATE
       SET onshape_document_id = EXCLUDED.onshape_document_id,
           onshape_workspace_id = EXCLUDED.onshape_workspace_id,
           onshape_element_id = EXCLUDED.onshape_element_id,
           mass_kg = EXCLUDED.mass_kg,
           volume_m3 = EXCLUDED.volume_m3,
           principal_inertia_kg_m2 = EXCLUDED.principal_inertia_kg_m2,
           material = EXCLUDED.material,
           onshape_microversion_id = EXCLUDED.onshape_microversion_id,
           measured_at = now(),
           measured_by = EXCLUDED.measured_by,
           updated_at = now()`,
    [
      input.orgId,
      input.lessonId,
      input.documentId,
      input.workspaceId,
      input.elementId,
      input.measured.massKg,
      input.measured.volumeM3,
      input.measured.principalInertiaKgM2,
      input.material,
      input.measured.microversionId,
      input.userId,
    ],
  );
}

export type SubmissionRow = {
  id: string;
  lessonId: string;
  userId: string;
  displayName: string | null;
  massKg: number;
  massPercentDifference: number;
  inertiaPercentDifference: number | null;
  overallBand: "match" | "close" | "off";
  material: string;
  gradedAt: string;
};

export async function readSubmissions(
  client: PoolClient,
  orgId: string,
  limit = 40,
): Promise<SubmissionRow[]> {
  // RLS narrows this to the caller's own rows unless they are a lead, so one
  // query serves both views without a role branch that could be got wrong.
  const result = await client.query<SubmissionRow>(
    `SELECT s.id,
            s.lesson_id AS "lessonId",
            s.user_id AS "userId",
            COALESCE(NULLIF(btrim(u.name), ''), u.email) AS "displayName",
            s.mass_kg AS "massKg",
            s.mass_percent_difference AS "massPercentDifference",
            s.inertia_percent_difference AS "inertiaPercentDifference",
            s.overall_band AS "overallBand",
            s.material,
            s.graded_at::text AS "gradedAt"
       FROM cad_learn_submissions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.org_id = $1::uuid
      ORDER BY s.graded_at DESC
      LIMIT $2::int`,
    [orgId, limit],
  );
  return result.rows;
}

export async function recordSubmission(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    lessonId: string;
    documentId: string;
    workspaceId: string;
    elementId: string;
    measured: PartMassProperties;
    massPercentDifference: number;
    inertiaPercentDifference: number | null;
    overallBand: "match" | "close" | "off";
    material: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO cad_learn_submissions
       (org_id, user_id, lesson_id, onshape_document_id, onshape_workspace_id, onshape_element_id,
        mass_kg, volume_m3, principal_inertia_kg_m2,
        mass_percent_difference, inertia_percent_difference, overall_band, material)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
             $7::double precision, $8::double precision, $9::double precision[],
             $10::double precision, $11::double precision, $12, $13)`,
    [
      input.orgId,
      input.userId,
      input.lessonId,
      input.documentId,
      input.workspaceId,
      input.elementId,
      input.measured.massKg,
      input.measured.volumeM3,
      input.measured.principalInertiaKgM2,
      input.massPercentDifference,
      input.inertiaPercentDifference,
      input.overallBand,
      input.material,
    ],
  );
}

export function failResponse(error: unknown, fallback: string) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status });
}
