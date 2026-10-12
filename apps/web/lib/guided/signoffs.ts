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

export type SignoffRequest = {
  status: SignoffStatus;
  id: string | null;
  /** True when this press made a new request (first ask, or asking again after a decline). */
  fresh: boolean;
};

/** Ask for a lead's sign-off, or ask again after a decline. An approved one stays approved. */
export async function requestSignoff(
  client: PoolClient,
  input: { orgId: string; userId: string; trackId: string; stepId: string },
): Promise<SignoffRequest> {
  const result = await client.query<{ id: string; status: SignoffStatus }>(
    `INSERT INTO guided_signoffs (org_id, user_id, lesson_id)
     VALUES ($1::uuid, $2::uuid, $3::text)
     ON CONFLICT (org_id, user_id, lesson_id) DO UPDATE
       SET status = 'requested', note = NULL, decided_by = NULL, decided_at = NULL, requested_at = now()
       WHERE guided_signoffs.status = 'declined'
     RETURNING id::text AS id, status`,
    [input.orgId, input.userId, guidedLessonId(input.trackId, input.stepId)],
  );
  if (result.rows[0]) return { status: result.rows[0].status, id: result.rows[0].id, fresh: true };
  // Already requested or approved: the conflict update did nothing; report what is there.
  const existing = await client.query<{ id: string; status: SignoffStatus }>(
    `SELECT id::text AS id, status FROM guided_signoffs WHERE org_id = $1::uuid AND user_id = $2::uuid AND lesson_id = $3::text`,
    [input.orgId, input.userId, guidedLessonId(input.trackId, input.stepId)],
  );
  const row = existing.rows[0];
  return { status: row?.status ?? "requested", id: row?.id ?? null, fresh: false };
}

/** Team progress, where leads sign steps off. */
export function teamProgressHref(orgId: string): string {
  return `/learn/guided/team?orgId=${encodeURIComponent(orgId)}`;
}

/** The step a notice is about, where the student reads the decision. */
export function guidedStepHref(orgId: string, trackId: string, stepId: string): string {
  return `/learn/guided/${encodeURIComponent(trackId)}?orgId=${encodeURIComponent(orgId)}#step-${encodeURIComponent(stepId)}`;
}

type Notify = (client: PoolClient, input: { userId: string; orgId: string; type: string; payload: Record<string, unknown> }) => Promise<void>;

/**
 * Tell every owner and admin (except the student) that a step is waiting for them (A5-16).
 * Returns how many were told. 0723's policy only lets the inbox row name the student's own
 * pending request, so this cannot carry anything else.
 */
export async function notifyLeadsOfRequest(
  client: PoolClient,
  emit: Notify,
  input: { orgId: string; userId: string; signoffId: string; trackId: string; stepId: string },
): Promise<number> {
  const named = describeGuidedLesson(guidedLessonId(input.trackId, input.stepId));
  if (!named) return 0;
  const [leads, me] = await Promise.all([
    client.query<{ userId: string }>(
      `SELECT user_id::text AS "userId" FROM memberships
       WHERE org_id = $1::uuid AND role IN ('owner', 'admin') AND user_id <> $2::uuid`,
      [input.orgId, input.userId],
    ),
    client.query<{ name: string | null }>(
      `SELECT NULLIF(btrim(name), '') AS name FROM users WHERE id = $1::uuid`,
      [input.userId],
    ),
  ]);
  const who = me.rows[0]?.name ?? "A teammate";
  for (const lead of leads.rows) {
    await emit(client, {
      userId: lead.userId,
      orgId: input.orgId,
      type: "guided_signoff_requested",
      payload: {
        signoffId: input.signoffId,
        title: `${who} asked you to sign off a step`,
        body: `${named.trackTitle}: ${named.stepTitle}. Check it with them, then sign it off or send it back on Team progress.`,
        href: teamProgressHref(input.orgId),
      },
    });
  }
  return leads.rows.length;
}

/** Tell the student what a lead decided, with the lead's note (A5-16). */
export async function notifyStudentOfDecision(
  client: PoolClient,
  emit: Notify,
  input: { orgId: string; decided: DecidedSignoff },
): Promise<boolean> {
  const named = describeGuidedLesson(input.decided.lessonId);
  if (!named) return false;
  const approved = input.decided.status === "approved";
  await emit(client, {
    userId: input.decided.userId,
    orgId: input.orgId,
    type: "guided_signoff_decided",
    payload: {
      signoffId: input.decided.id,
      title: approved ? `Signed off: ${named.stepTitle}` : `Try again: ${named.stepTitle}`,
      body: approved
        ? `A lead signed off this step of ${named.trackTitle}. It counts as done.`
        : `A lead sent this step of ${named.trackTitle} back${input.decided.note ? `: “${input.decided.note}”` : "."} Fix it, then ask again.`,
      href: guidedStepHref(input.orgId, named.trackId, named.stepId),
    },
  });
  return true;
}

/** Withdraw a request, or give up an approval to redo the step. */
export async function clearMySignoff(client: PoolClient, input: { orgId: string; userId: string; trackId: string; stepId: string }) {
  await client.query(`DELETE FROM guided_signoffs WHERE org_id = $1::uuid AND user_id = $2::uuid AND lesson_id = $3::text`, [
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
      WHERE org_id = $1::uuid AND user_id = $2::uuid AND lesson_id LIKE $3::text`,
    [input.orgId, input.userId, `${prefix}%`],
  );
  return result.rows.map((row) => ({ stepId: row.lessonId.slice(prefix.length), status: row.status, note: row.note, decidedAt: row.decidedAt }));
}

/**
 * True for a step only a lead's sign-off completes. Before migration 0719 the student's own
 * button wrote these into cad_learn_progress; those self-marked rows never count as done.
 */
export function needsLeadSignoff(trackId: string, stepId: string): boolean {
  return GUIDED_TRACKS.find((t) => t.id === trackId)?.steps.find((s) => s.id === stepId)?.check.kind === "lead-signoff";
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

export type DecidedSignoff = { id: string; userId: string; lessonId: string; status: "approved" | "declined"; note: string | null };

/** A lead approves or declines. Returns null when the request is gone or is the lead's own. */
export async function decideSignoff(
  client: PoolClient,
  input: { orgId: string; leadId: string; id: string; approve: boolean; note?: string | null },
): Promise<DecidedSignoff | null> {
  const note = input.note?.trim().slice(0, 500) || null;
  const result = await client.query<DecidedSignoff>(
    `UPDATE guided_signoffs
        SET status = $4::text, note = $5::text, decided_by = $3::uuid, decided_at = now()
      WHERE id = $2::uuid AND org_id = $1::uuid AND status = 'requested' AND user_id <> $3::uuid
      RETURNING id::text AS id, user_id::text AS "userId", lesson_id AS "lessonId", status, note`,
    [input.orgId, input.id, input.leadId, input.approve ? "approved" : "declined", note],
  );
  return result.rows[0] ?? null;
}

/** How many sign-off requests wait on this lead (not their own). Zero for anyone else under RLS. */
export async function countPendingSignoffs(client: PoolClient, input: { orgId: string; leadId: string }): Promise<number> {
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM guided_signoffs
      WHERE org_id = $1::uuid AND status = 'requested' AND user_id <> $2::uuid`,
    [input.orgId, input.leadId],
  );
  return result.rows[0]?.n ?? 0;
}

export type MemberTrackProgress = { userId: string; displayName: string; tracks: Record<string, number>; lastActivityAt: string | null };

/**
 * Steps done per member per guided track: checked steps from cad_learn_progress plus approved
 * sign-offs. Only steps that still exist count, so a renamed step never inflates a total.
 */
export async function readTeamGuidedProgress(client: PoolClient, orgId: string): Promise<MemberTrackProgress[]> {
  const result = await client.query<{ userId: string; displayName: string; lessonId: string; at: string; via: "check" | "signoff" }>(
    `SELECT x.user_id AS "userId", COALESCE(NULLIF(btrim(u.name), ''), u.email) AS "displayName", x.lesson_id AS "lessonId",
            x.at::text AS at, x.via
       FROM (
         SELECT user_id, lesson_id, completed_at AS at, 'check'::text AS via FROM cad_learn_progress
          WHERE org_id = $1::uuid AND completed_at IS NOT NULL AND lesson_id LIKE 'guided:%'
         UNION ALL
         SELECT user_id, lesson_id, decided_at AS at, 'signoff'::text AS via FROM guided_signoffs
          WHERE org_id = $1::uuid AND status = 'approved'
       ) x
       JOIN users u ON u.id = x.user_id`,
    [orgId],
  );
  // Everyone on the team, so a lead sees who has not started (A5-19). View-only members are
  // parents and guests, not learners, and are left out.
  const roster = await client.query<{ userId: string; displayName: string }>(
    `SELECT m.user_id::text AS "userId", COALESCE(NULLIF(btrim(u.name), ''), u.email) AS "displayName"
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid AND m.role <> 'viewer'`,
    [orgId],
  );
  return summarizeTeamProgress(result.rows, roster.rows);
}

/**
 * Pure: rows of (member, finished lesson) → per-member counts per track. A step that needs a
 * lead counts only from an approved sign-off, never from a progress row (`via: "check"`).
 * Members on the roster with nothing finished are listed with empty counts.
 */
export function summarizeTeamProgress(
  rows: Array<{ userId: string; displayName: string; lessonId: string; at: string; via?: "check" | "signoff" }>,
  roster: ReadonlyArray<{ userId: string; displayName: string }> = [],
): MemberTrackProgress[] {
  const members = new Map<string, MemberTrackProgress & { seen: Set<string> }>();
  for (const person of roster) {
    members.set(person.userId, { userId: person.userId, displayName: person.displayName, tracks: {}, lastActivityAt: null, seen: new Set<string>() });
  }
  for (const row of rows) {
    const named = describeGuidedLesson(row.lessonId);
    if (!named) continue;
    if (row.via !== "signoff" && needsLeadSignoff(named.trackId, named.stepId)) continue;
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
