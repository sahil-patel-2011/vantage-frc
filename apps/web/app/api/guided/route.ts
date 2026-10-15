import { auth, emitNotification } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import { headers } from "next/headers";
import { HttpError, failResponse, isLead, markProgress, resolveMembership } from "../../../lib/cad-learn/store";
import { acquireOnshape } from "../../../lib/cad-learn/onshape-access";
import { runGuidedCheck, type CheckInput } from "../../../lib/guided/run-check";
import type { CheckResult } from "../../../lib/guided/types";
import {
  clearMySignoff,
  needsLeadSignoff,
  notifyLeadsOfRequest,
  readMySignoffs,
  requestSignoff,
  summarizeTeamProgress,
} from "../../../lib/guided/signoffs";
import { guidedStep, guidedTrack } from "../../../lib/guided/tracks";
import { GUIDED_PREFIX, guidedLessonId } from "../../../lib/guided/types";

/** A finished answer, or the team and person a check should run for once the transaction closes. */
type GuidedResult = (CheckResult & { pending?: boolean }) | { run: { orgId: string; userId: string } };

/** The signed-in student's finished steps on one guided track. */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const url = new URL(request.url);
    // No track: the student's steps done on every track, for the index (A5-27).
    if (!url.searchParams.get("track")) {
      const summary = await withRls({ userId: session.user.id }, async (client) => {
        const membership = await resolveMembership(client, session.user.id, url.searchParams.get("orgId"));
        const rows = await client.query<{ lessonId: string; via: "check" | "signoff" }>(
          `SELECT lesson_id AS "lessonId", 'check'::text AS via FROM cad_learn_progress
            WHERE org_id = $1::uuid AND user_id = $2::uuid AND completed_at IS NOT NULL AND lesson_id LIKE 'guided:%'`,
          [membership.orgId, session.user.id],
        );
        const approved = await withSavepoint(
          client,
          async () =>
            (
              await client.query<{ lessonId: string; via: "check" | "signoff" }>(
                `SELECT lesson_id AS "lessonId", 'signoff'::text AS via FROM guided_signoffs
                  WHERE org_id = $1::uuid AND user_id = $2::uuid AND status = 'approved'`,
                [membership.orgId, session.user.id],
              )
            ).rows,
          [],
        );
        const counted = summarizeTeamProgress(
          [...rows.rows, ...approved].map((row) => ({ ...row, userId: session.user.id, displayName: "", at: "" })),
        );
        return { tracks: counted[0]?.tracks ?? {}, isLead: isLead(membership) };
      });
      return Response.json(summary, { headers: { "cache-control": "private, no-store" } });
    }
    const track = guidedTrack(url.searchParams.get("track") ?? "");
    if (!track) throw new HttpError(404, "Unknown track");
    const { done, signoffs } = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, url.searchParams.get("orgId"));
      const rows = await client.query<{ lessonId: string; completedAt: string }>(
        `SELECT lesson_id AS "lessonId", completed_at::text AS "completedAt"
           FROM cad_learn_progress
          WHERE org_id = $1::uuid AND user_id = $2::uuid AND completed_at IS NOT NULL
            AND lesson_id LIKE $3`,
        [membership.orgId, session.user.id, `${GUIDED_PREFIX}${track.id}:%`],
      );
      const checked = rows.rows
        .map((row) => ({ stepId: row.lessonId.slice(`${GUIDED_PREFIX}${track.id}:`.length), completedAt: row.completedAt }))
        // A step that needs a lead is done only by an approved sign-off (read below), never by an
        // older self-marked progress row.
        .filter((row) => !needsLeadSignoff(track.id, row.stepId));
      // Before migration 0719 there are no sign-offs to read; the track still loads.
      const mine = await withSavepoint(client, () => readMySignoffs(client, { orgId: membership.orgId, userId: session.user.id, trackId: track.id }), []);
      const approved = mine.filter((s) => s.status === "approved" && s.decidedAt).map((s) => ({ stepId: s.stepId, completedAt: s.decidedAt! }));
      return { done: [...checked.filter((c) => !approved.some((a) => a.stepId === c.stepId)), ...approved], signoffs: mine };
    });
    return Response.json({ trackId: track.id, done, signoffs }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return failResponse(error, "Could not load this track");
  }
}

type Body = { trackId?: string; stepId?: string; input?: CheckInput; action?: string; orgId?: string };

/** Runs a step's check and, when it passes, records the step as done. `action: "reopen"` undoes it. */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const body = (await request.json().catch(() => ({}))) as Body;
    const step = guidedStep(String(body.trackId ?? ""), String(body.stepId ?? ""));
    if (!step) throw new HttpError(400, "Unknown step");
    const lessonId = guidedLessonId(String(body.trackId), step.id);

    const requestedOrg = typeof body.orgId === "string" && /^[0-9a-f-]{36}$/i.test(body.orgId) ? body.orgId : null;
    // 1. A short transaction: whose team, plus the steps that are only database work (reopen,
    //    withdraw, sign-off requests). Checks that ask Onshape or GitHub run after it closes.
    const result = await withRls({ userId: session.user.id }, async (client): Promise<GuidedResult> => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const who = { orgId: membership.orgId, userId: session.user.id };
      const signoffKey = { ...who, trackId: String(body.trackId), stepId: step.id };
      if (body.action === "reopen" || body.action === "withdraw") {
        await markProgress(client, { ...who, lessonId, completed: false });
        if (step.check.kind === "lead-signoff") await clearMySignoff(client, signoffKey);
        return body.action === "withdraw"
          ? { passed: false, message: "Request withdrawn." }
          : { passed: false, message: "Reopened. Check it again when you are ready." };
      }
      if (step.check.kind === "lead-signoff") {
        const request = await requestSignoff(client, signoffKey);
        if (request.status === "approved") return { passed: true, message: "A lead signed this off." };
        // Tell the leads (A5-16). A failed notice never undoes the request: the step still waits
        // on Team progress, where every lead sees it.
        const told =
          request.fresh && request.id
            ? await withSavepoint(
                client,
                () =>
                  notifyLeadsOfRequest(client, emitNotification, {
                    ...who,
                    signoffId: request.id!,
                    trackId: String(body.trackId),
                    stepId: step.id,
                  }),
                0,
              )
            : null;
        return {
          passed: false,
          pending: true,
          message:
            told === 0
              ? "Asked for a sign-off. Your team has no owner or admin to check it yet; it waits on Team progress."
              : "Sent to your team's owners and admins. They get a notice and check it with you; the step counts once one of them signs it off.",
        };
      }
      return { run: who };
    });
    if (!("run" in result)) return Response.json(result);

    // 2. The check itself, with no transaction open. The Onshape connection is read in its own
    //    short transaction only when the step needs it.
    const who = result.run;
    const onshape = () => withRls({ userId: who.userId }, (client) => acquireOnshape(client, who.orgId, who.userId));
    const outcome = await runGuidedCheck(onshape, step.check, body.input ?? {});

    // 3. A second short transaction records a pass.
    if (outcome.passed) {
      await withRls({ userId: who.userId }, (client) => markProgress(client, { ...who, lessonId, completed: true }));
    }
    return Response.json(outcome);
  } catch (error) {
    // Lead sign-offs need migration 0719: say so instead of passing a database message on.
    if ((error as { code?: string } | null)?.code === "42P01") {
      return Response.json({ status: "setup_required", passed: false, message: "Lead sign-offs need a database update (0719). Ask your team's owner." }, { status: 503 });
    }
    return failResponse(error, "Could not check that step");
  }
}
