import type { PoolClient } from "@neondatabase/serverless";
import { GUIDED_TRACKS } from "./tracks";
import { GUIDED_PREFIX, guidedLessonId } from "./types";

/**
 * Lead sign-offs for the guided steps software cannot check (migration 0719). The student asks;
 * an owner or admin approves or declines; an approved sign-off counts as the step being done.
 * RLS enforces who may do what — these helpers only shape the queries.
 */

export type SignoffStatus = "requested" | "approved" | "declined";

export type MySignoff = { stepId: string; status: SignoffStatus; note: string | null; decidedAt: string | null };

/** Ask for a lead's sign-off, or ask again after a decline. An approved one stays approved. */
export async function requestSignoff(
  client: PoolClient,
  input: { orgId: string; userId: string; trackId: string; stepId: string },
): Promise<SignoffStatus> {
  const result = await client.query<{ status: SignoffStatus }>(
    `INSERT INTO guided_signoffs (org_id, user_id, lesson_id)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (org_id, user_id, lesson_id) DO UPDATE
       SET status = 'requested', note = NULL, decided_by = NULL, decided_at = NULL, requested_at = now()
       WHERE guided_signoffs.status = 'declined'
     RETURNING status`,
    [input.orgId, input.userId, guidedLessonId(input.trackId, input.stepId)],
  );
  if (result.rows[0]) return result.rows[0].status;
  // Already requested or approved: the conflict update did nothing; report what is there.
  const existing = await client.query<{ status: SignoffStatus }>(
    `SELECT status FROM guided_signoffs WHERE org_id = $1::uuid AND user_id = $2::uuid AND lesson_id = $3`,
    [input.orgId, input.userId, guidedLessonId(input.trackId, input.stepId)],
  );
  return existing.rows[0]?.status ?? "requested";
}

/** Withdraw a request, or give up an approval to redo the step. */
export async function clearMySignoff(client: PoolClient, input: { orgId: string; userId: string; trackId: string; stepId: string }) {
  await client.query(`DELETE FROM guided_signoffs WHERE org_id = $1::uuid AND user_id = $2::uuid AND lesson_id = $3`, [
    input.orgId,
    input.userId,
    guidedLessonId(input.trackId, input.stepId),
  ]);
}

/** The student's own sign-offs on one track. */
export async function readMySignoffs(client: PoolClient, input: { orgId: string; userId: string; trackId: string }): Promise<MySignoff[]> {
  const prefix = `${GUIDED_PREFIX}${input.trackId}:`;
  const result = await client.query<{ lessonId: string; status: SignoffStatus; note: string | null; decidedAt: string | null }>(
    `SELECT lesson_id AS "lessonId", status, note, decided_at::text AS "decidedAt"
       FROM guided_signoffs
      WHERE org_id = $1::uuid AND user_id = $2::uuid AND lesson_id LIKE $3`,
    [input.orgId, input.userId, `${prefix}%`],
  );
  return result.rows.map((row) => ({ stepId: row.lessonId.slice(prefix.length), status: row.status, note: row.note, decidedAt: row.decidedAt }));
}

/** Names a guided lesson id in words: track title and step title. Null for a step that no longer exists. */
export function describeGuidedLesson(lessonId: string): { trackId: string; stepId: string; trackTitle: string; stepTitle: string } | null {
  if (!lessonId.startsWith(GUIDED_PREFIX)) return null;
  const [trackId, stepId] = lessonId.slice(GUIDED_PREFIX.length).split(":");
  const track = GUIDED_TRACKS.find((t) => t.id === trackId);
  const step = track?.steps.find((s) => s.id === stepId);
  if (!track || !step || !stepId) return null;
  return { trackId: track.id, stepId, trackTitle: track.title, stepTitle: step.title };
}

export type PendingSignoff = {
  id: string;
  userId: string;
  displayName: string;
  requestedAt: string;
  trackId: string;
  stepId: string;
  trackTitle: string;
  stepTitle: string;
  /** What the lead checks, from the step itself. */
  what: string;
};

/** Requests waiting on a lead, oldest first. RLS returns only the caller's own unless they lead. */
export async function readPendingSignoffs(client: PoolClient, orgId: string): Promise<PendingSignoff[]> {
  const result = await client.query<{ id: string; userId: string; displayName: string; requestedAt: string; lessonId: string }>(
    `SELECT s.id, s.user_id AS "userId", COALESCE(NULLIF(btrim(u.name), ''), u.email) AS "displayName",
            s.requested_at::text AS "requestedAt", s.lesson_id AS "lessonId"
       FROM guided_signoffs s
       JOIN users u ON u.id = s.user_id
      WHERE s.org_id = $1::uuid AND s.status = 'requested'
      ORDER BY s.requested_at
      LIMIT 200`,
    [orgId],
  );
  return result.rows.flatMap((row) => {
    const named = describeGuidedLesson(row.lessonId);
    if (!named) return [];
    const step = GUIDED_TRACKS.find((t) => t.id === named.trackId)?.steps.find((s) => s.id === named.stepId);
    const what = step?.check.kind === "lead-signoff" ? step.check.what : step?.checkedBy ?? "";
    return [{ id: row.id, userId: row.userId, displayName: row.displayName, requestedAt: row.requestedAt, ...named, what }];
  });
}

/** A lead approves or declines. Returns false when the request is gone or is the lead's own. */
export async function decideSignoff(
  client: PoolClient,
  input: { orgId: string; leadId: string; id: string; approve: boolean; note?: string | null },
): Promise<boolean> {
  const note = input.note?.trim().slice(0, 500) || null;
  const result = await client.query(
    `UPDATE guided_signoffs
        SET status = $4, note = $5, decided_by = $3::uuid, decided_at = now()
      WHERE id = $2::uuid AND org_id = $1::uuid AND status = 'requested' AND user_id <> $3::uuid`,
    [input.orgId, input.id, input.leadId, input.approve ? "approved" : "declined", note],
  );
  return (result.rowCount ?? 0) > 0;
}

export type MemberTrackProgress = { userId: string; displayName: string; tracks: Record<string, number>; lastActivityAt: string | null };

/**
 * Steps done per member per guided track: checked steps from cad_learn_progress plus approved
 * sign-offs. Only steps that still exist count, so a renamed step never inflates a total.
 */
export async function readTeamGuidedProgress(client: PoolClient, orgId: string): Promise<MemberTrackProgress[]> {
  const result = await client.query<{ userId: string; displayName: string; lessonId: string; at: string }>(
    `SELECT x.user_id AS "userId", COALESCE(NULLIF(btrim(u.name), ''), u.email) AS "displayName", x.lesson_id AS "lessonId", x.at::text AS at
       FROM (
         SELECT user_id, lesson_id, completed_at AS at FROM cad_learn_progress
          WHERE org_id = $1::uuid AND completed_at IS NOT NULL AND lesson_id LIKE 'guided:%'
         UNION
         SELECT user_id, lesson_id, decided_at AS at FROM guided_signoffs
          WHERE org_id = $1::uuid AND status = 'approved'
       ) x
       JOIN users u ON u.id = x.user_id`,
    [orgId],
  );
  return summarizeTeamProgress(result.rows);
}

/** Pure: rows of (member, finished lesson) → per-member counts per track. */
export function summarizeTeamProgress(rows: Array<{ userId: string; displayName: string; lessonId: string; at: string }>): MemberTrackProgress[] {
  const members = new Map<string, MemberTrackProgress & { seen: Set<string> }>();
  for (const row of rows) {
    const named = describeGuidedLesson(row.lessonId);
    if (!named) continue;
    const member = members.get(row.userId) ?? { userId: row.userId, displayName: row.displayName, tracks: {}, lastActivityAt: null, seen: new Set<string>() };
    if (!member.seen.has(row.lessonId)) {
      member.seen.add(row.lessonId);
      member.tracks[named.trackId] = (member.tracks[named.trackId] ?? 0) + 1;
    }
    if (!member.lastActivityAt || row.at > member.lastActivityAt) member.lastActivityAt = row.at;
    members.set(row.userId, member);
  }
  return [...members.values()]
    .map(({ seen: _seen, ...member }) => member)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
