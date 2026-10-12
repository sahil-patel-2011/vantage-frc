import { auth, emitNotification } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import { headers } from "next/headers";
import { HttpError, isLead, resolveMembership } from "../../../../lib/cad-learn/store";
import {
  decideSignoff,
  notifyStudentOfDecision,
  readPendingSignoffs,
  readTeamGuidedProgress,
} from "../../../../lib/guided/signoffs";
import { GUIDED_TRACKS, guidedTrackShortTitle } from "../../../../lib/guided/tracks";
import { publicErrorMessage } from "../../../../lib/security/public-error";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function orgParam(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value.trim()) ? value.trim() : null;
}

function fail(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  // 42P01: migration 0719 is not applied yet — a setup state, not a crash.
  if ((error as { code?: string } | null)?.code === "42P01") {
    return Response.json({ status: "setup_required", error: "Lead sign-offs need database migration 0719." }, { status: 503 });
  }
  return Response.json({ error: publicErrorMessage(error, "Couldn't load team progress") }, { status: 500 });
}

async function lead() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Sign in to see team progress.");
  return session;
}

/** Team progress on the guided tracks, and sign-offs waiting on a lead. Owners and admins only. */
export async function GET(request: Request) {
  try {
    const session = await lead();
    const orgId = orgParam(new URL(request.url).searchParams.get("orgId"));
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, orgId);
      if (!isLead(membership)) throw new HttpError(403, "Only owners and admins see team progress and sign steps off.");
      const [pending, members] = await Promise.all([readPendingSignoffs(client, membership.orgId), readTeamGuidedProgress(client, membership.orgId)]);
      return {
        status: "ready" as const,
        orgId: membership.orgId,
        orgName: membership.orgName,
        tracks: GUIDED_TRACKS.map((track) => ({
          id: track.id,
          title: track.title,
          shortTitle: guidedTrackShortTitle(track),
          steps: track.steps.length,
        })),
        pending: pending.filter((row) => row.userId !== session.user.id),
        ownPending: pending.filter((row) => row.userId === session.user.id).length,
        members,
      };
    });
    return Response.json(view, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}

type Body = { orgId?: unknown; action?: unknown; id?: unknown; note?: unknown };

/** Approve or decline one sign-off request. */
export async function POST(request: Request) {
  try {
    const session = await lead();
    const body = (await request.json().catch(() => ({}))) as Body;
    if (body.action !== "approve" && body.action !== "decline") throw new HttpError(400, "action must be approve or decline");
    const id = orgParam(body.id);
    if (!id) throw new HttpError(400, "id is required");
    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, orgParam(body.orgId));
      if (!isLead(membership)) throw new HttpError(403, "Only owners and admins sign steps off.");
      const decided = await decideSignoff(client, {
        orgId: membership.orgId,
        leadId: session.user.id,
        id,
        approve: body.action === "approve",
        note: typeof body.note === "string" ? body.note : null,
      });
      if (!decided) return { decided: false, told: false };
      // The student hears the decision and the note (A5-16). A failed notice never undoes it.
      const told = await withSavepoint(
        client,
        () => notifyStudentOfDecision(client, emitNotification, { orgId: membership.orgId, decided }),
        false,
      );
      return { decided: true, told };
    });
    if (!result.decided) throw new HttpError(409, "That request was already decided, withdrawn, or is your own.");
    return Response.json({ ok: true, told: result.told });
  } catch (error) {
    return fail(error);
  }
}
