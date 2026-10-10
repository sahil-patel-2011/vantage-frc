import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { isScoutForbidden } from "../../../lib/scout-org-access";
import { assertCoverageSession } from "../../../lib/scouting/coverage-access";
import { coverageEventKey } from "../../../lib/scouting/coverage-request";
import { acknowledgeCoverageNudge, computeScoutCoverageLiveView, sendCoverageNudge, setThinThreshold } from "../../../lib/scout-coverage-live/compute-scout-coverage-live";
import { reviewMutationRequest, type ReviewResult } from "../../../lib/scout-coverage-live/request";
import { parseSecureJson, RequestSecurityError } from "../../../lib/security/request";
import { classifyDbError } from "../../../lib/db-error";
export type { ScoutCoverageLiveView } from "../../../lib/scout-coverage-live/compute-scout-coverage-live";

function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
}
function failure(error: unknown) {
  if (error instanceof RequestSecurityError) return privateJson({ error: error.message }, error.status);
  if (isScoutForbidden(error)) return privateJson({ error: "Organization access denied" }, 403);
  if (error && typeof error === "object" && "status" in error && error.status === 403) return privateJson({ error: "Scouting lead access required." }, 403);
  const friendly = classifyDbError(error);
  if (friendly) return privateJson({ error: friendly.message }, friendly.status);
  return privateJson({ error: "Coverage review is temporarily unavailable. Refresh to check the saved result before retrying." }, 503);
}
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return privateJson({ error: "Your session ended. Sign in again." }, 401);
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId") || null;
    const eventKey = url.searchParams.get("eventKey") || null;
    if ((orgId && !z.string().uuid().safeParse(orgId).success) || (eventKey && !coverageEventKey.safeParse(eventKey).success)) throw new RequestSecurityError(400, "Choose a valid team and event.");
    const view = await withRls({ userId: session.user.id }, async client => {
      if (orgId) await assertCoverageSession(client, session, orgId);
      const result = await computeScoutCoverageLiveView(client, { userId: session.user.id, requestedOrg: orgId, requestedEvent: eventKey });
      if (!orgId && result.orgId) await assertCoverageSession(client, session, result.orgId);
      return result;
    });
    return privateJson(view);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return privateJson({ error: "Your session ended. Sign in again." }, 401);
    const body = await parseSecureJson(request, reviewMutationRequest);
    if (body.action === "set-threshold" && body.expectedThreshold === undefined) throw new RequestSecurityError(409, "Refresh coverage review before saving its report target.");
    const view = await withRls({ userId: session.user.id, orgId: body.orgId }, async client => {
      await assertCoverageSession(client, session, body.orgId);
      const input = { userId: session.user.id, requestedOrg: body.orgId, requestedEvent: body.eventKey };
      const before = await computeScoutCoverageLiveView(client, input);
      if (before.status !== "live" || before.orgId !== body.orgId || before.eventKey !== body.eventKey) throw new RequestSecurityError(409, "Refresh the selected event before changing its coverage review.");
      let result: ReviewResult;
      switch (body.action) {
        case "set-threshold":
          if (body.expectedThreshold === undefined) throw new RequestSecurityError(409, "Refresh coverage review before saving its report target.");
          await setThinThreshold(client, { orgId: body.orgId, userId: session.user.id, thinThreshold: body.thinThreshold, expectedThreshold: body.expectedThreshold });
          result = { action: body.action, thinThreshold: body.thinThreshold };
          break;
        case "send-nudge": {
          const cell = before.cells.find(row => row.matchKey === body.matchKey && row.teamKey === body.teamKey);
          if (!cell) throw new RequestSecurityError(400, "Choose a robot from this event's schedule.");
          if (cell.played === false ? cell.entryCount !== 0 || (cell.assignmentCount ?? 0) !== 0 : cell.status === "covered") throw new RequestSecurityError(409, "Coverage changed: this robot no longer needs this flag. Refresh to review it.");
          const flag = await sendCoverageNudge(client, { ...body, userId: session.user.id });
          result = { action: body.action, nudgeId: flag.id, matchKey: body.matchKey, teamKey: body.teamKey, created: flag.created };
          break;
        }
        case "acknowledge-nudge": {
          const confirmed = await acknowledgeCoverageNudge(client, { ...body, userId: session.user.id });
          result = { action: body.action, nudgeId: body.nudgeId, acknowledgedAt: confirmed.acknowledgedAt };
          break;
        }
      }
      const next = await computeScoutCoverageLiveView(client, input);
      if (next.status !== "live" || next.orgId !== body.orgId || next.eventKey !== body.eventKey) throw new Error("Coverage result could not be confirmed");
      if (result.action === "set-threshold" && next.thinThreshold !== result.thinThreshold) throw new Error("Report target could not be confirmed");
      return { ...next, coverageResult: result };
    });
    return privateJson(view);
  } catch (error) { return failure(error); }
}
