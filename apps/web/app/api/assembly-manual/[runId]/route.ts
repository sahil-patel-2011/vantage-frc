import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  HttpError,
  countSteps,
  failResponse,
  getRun,
  listSteps,
  requestCancel,
  requireLead,
  resolveMembership,
} from "../../../../lib/assembly-manual/store";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One run: its progress, its report, and a page of steps.
 *
 * Steps come back without their images — a run's renders are tens of megabytes
 * and the viewer fetches them one at a time from the step route. The page
 * defaults to 40 steps, which is what the viewer holds at once.
 */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const { runId } = await params;
    if (!UUID.test(runId)) throw new HttpError(400, "That is not a run id.");

    const url = new URL(request.url);
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40));

    const payload = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      const run = await getRun(client, membership.orgId, runId);
      if (!run) throw new HttpError(404, "That run is not one of your team's.");
      const [steps, total] = await Promise.all([
        listSteps(client, membership.orgId, runId, offset, limit),
        countSteps(client, membership.orgId, runId),
      ]);
      return {
        run,
        steps,
        total,
        offset,
        limit,
        canCancel: membership.role === "owner" || membership.role === "admin",
      };
    });

    return Response.json(payload);
  } catch (error) {
    return failResponse(error, "Could not load that run.");
  }
}

/**
 * Ask the worker to stop. This does not flip the status itself — the run may be
 * mid-slice on a relay, and two writers racing on `status` is how a finished
 * run ends up marked cancelled.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const { runId } = await params;
    if (!UUID.test(runId)) throw new HttpError(400, "That is not a run id.");

    const payload = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      requireLead(membership);
      const requested = await requestCancel(client, membership.orgId, runId);
      return {
        requested,
        message: requested
          ? "Cancel requested. The worker stops at its next checkpoint, so this can take a minute."
          : "That run is not in a state that can be cancelled.",
      };
    });

    return Response.json(payload);
  } catch (error) {
    return failResponse(error, "Could not cancel that run.");
  }
}
