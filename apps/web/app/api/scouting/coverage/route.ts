import { canManageScouting } from "@vantage/scouting/permissions";
import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { applyAutoAssignments, assignCoverageSlot, computeScoutingCoverageView, planAutoAssignments, swapCoverageSlot } from "../../../../lib/scouting/coverage";
import { expandAssignmentRange, parseMatchKey } from "../../../../lib/scouting/assignment-range";
import { coverageEventKey, coverageMutationRequest, type AssignmentResult } from "../../../../lib/scouting/coverage-request";
import { lockAssignmentEvent } from "../../../../lib/scouting/assignment-write";
import { loadWatchlistTeamKeys } from "../../../../lib/watchlist";
import { isScoutForbidden } from "../../../../lib/scout-org-access";
import { assignmentConflict, describeAssignmentConflict, withAssignment } from "../../../../lib/scouting/assignment-conflicts";
import { loadAssignmentConflictContext } from "../../../../lib/scouting/assignment-conflicts-load";
import { parseSecureJson, RequestSecurityError } from "../../../../lib/security/request";
import { classifyDbError } from "../../../../lib/db-error";

function noStore(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}
function failure(error: unknown) {
  if (isScoutForbidden(error)) return noStore({ error: "Organization access denied" }, 403);
  if (error instanceof RequestSecurityError) return noStore({ error: error.message }, error.status);
  const friendly = classifyDbError(error);
  if (friendly) return noStore({ error: friendly.message }, friendly.status);
  return noStore({ error: "Assignments are temporarily unavailable. Refresh to check the saved result before retrying." }, 503);
}
async function sessionPolicy(client: PoolClient, session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>, orgId: string) {
  const member = await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid", [orgId, session.user.id]);
  if (!member.rowCount) throw new RequestSecurityError(403, "Team access changed. Choose a team you belong to.");
  try {
    await assertOrgAuthentication(client, { userId: session.user.id, orgId, sessionId: session.session.id,
      authMethod: String((session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown"),
      rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value });
  } catch { throw new RequestSecurityError(403, "Re-authenticate to meet your team's current sign-in requirements."); }
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return noStore({ error: "Your session ended. Sign in again." }, 401);
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId") || null;
    const eventKey = url.searchParams.get("eventKey") || null;
    const matchKey = url.searchParams.get("matchKey") || undefined;
    const windowSize = Number(url.searchParams.get("window") ?? 4);
    if ((requestedOrg && !z.string().uuid().safeParse(requestedOrg).success) ||
      (eventKey && !coverageEventKey.safeParse(eventKey).success) ||
      (matchKey && !parseMatchKey(matchKey)) || !Number.isInteger(windowSize) || windowSize < 1 || windowSize > 12) {
      throw new RequestSecurityError(400, "Choose a valid team, event and focus match.");
    }
    const view = await withRls({ userId: session.user.id }, async client => {
      if (requestedOrg) await sessionPolicy(client, session, requestedOrg);
      const result = await computeScoutingCoverageView(client, { userId: session.user.id, requestedOrg, requestedEvent: eventKey,
        matchKey, windowSize, qualsOnly: !["0", "false"].includes(url.searchParams.get("qualsOnly") ?? ""),
        priorityTeamKeys: requestedOrg ? await loadWatchlistTeamKeys(client, requestedOrg) : undefined });
      if (!requestedOrg && result.orgId) await sessionPolicy(client, session, result.orgId);
      return result;
    });
    return noStore(view);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return noStore({ error: "Your session ended. Sign in again." }, 401);
    const body = await parseSecureJson(request, coverageMutationRequest);
    const view = await withRls({ userId: session.user.id, orgId: body.orgId }, async client => {
      const orgId = body.orgId;
      await sessionPolicy(client, session, orgId);
      if (!await canManageScouting(client, orgId)) throw new RequestSecurityError(403, "Scouting lead access required.");
      const sourceKey = body.action === "assign-range" ? body.firstMatchKey : "matchKey" in body ? body.matchKey : body.focusMatchKey;
      const keyEvent = parseMatchKey(sourceKey)?.eventKey;
      if (body.eventKey && keyEvent && body.eventKey !== keyEvent) throw new RequestSecurityError(400, "The match belongs to a different event. Refresh the selected event.");
      const eventKey = body.eventKey ?? keyEvent ?? (await client.query<{ eventKey: string | null }>(
        'SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id=$1::uuid', [orgId],
      )).rows[0]?.eventKey;
      if (!eventKey) throw new RequestSecurityError(422, "Choose an event before assigning scouts.");
      await lockAssignmentEvent(client, orgId, eventKey);
      const priorityTeamKeys = await loadWatchlistTeamKeys(client, orgId);
      const query = { userId: session.user.id, requestedOrg: orgId, requestedEvent: eventKey, priorityTeamKeys,
        qualsOnly: body.qualsOnly !== false, matchKey: body.focusMatchKey };
      const preview = await computeScoutingCoverageView(client, query);
      if (preview.status !== "live" || preview.orgId !== orgId || preview.eventKey !== eventKey) throw new RequestSecurityError(409, "The event changed. Refresh before assigning scouts.");
      let conflicts = await loadAssignmentConflictContext(client, { orgId, eventKey });
      const result: AssignmentResult = { action: body.action, assigned: 0, unchanged: 0, refused: [] };
      const requireMember = async (userId: string) => {
        const member = await client.query("SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid", [orgId, userId]);
        if (!member.rowCount) throw new RequestSecurityError(409, "That scout is no longer on this team. Choose a current member.");
      };
      const requireSlot = (matchKey: string, teamKey: string) => {
        if (!preview.slots.some(slot => slot.matchKey === matchKey && slot.teamKey === teamKey)) throw new RequestSecurityError(400, "Choose a robot and match from the selected event schedule.");
      };
      if (body.action === "auto-assign") {
        const plan = planAutoAssignments({ slots: preview.slots, playedMatchKeys: preview.playedMatchKeys, scouts: preview.scouts,
          priorityTeamKeys, isBlocked: (userId, slot) => assignmentConflict(conflicts, { userId, ...slot }) !== null });
        for (const userId of new Set(plan.map(row => row.userId))) await requireMember(userId);
        result.assigned = (await applyAutoAssignments(client, { orgId, eventKey, plan })).assigned;
        const unresolved = preview.slots.filter(slot => slot.status === "unscouted" && !preview.playedMatchKeys.includes(slot.matchKey) && !plan.some(row => row.matchKey === slot.matchKey && row.teamKey === slot.teamKey));
        if (unresolved.length) result.refused.push(`${unresolved.length} upcoming robots still need a scout. Add available scouts or review their conflicting assignments.`);
      } else if (body.action === "swap") {
        requireSlot(body.matchKey, body.teamKey);
        await requireMember(body.toUserId);
        if (body.fromUserId === body.toUserId) throw new RequestSecurityError(400, "Choose a different scout to reassign this robot.");
        const conflict = assignmentConflict(conflicts, { userId: body.toUserId, matchKey: body.matchKey, teamKey: body.teamKey });
        if (conflict) throw new RequestSecurityError(409, describeAssignmentConflict(conflict));
        const moved = await swapCoverageSlot(client, { orgId, matchKey: body.matchKey, teamKey: body.teamKey, fromUserId: body.fromUserId, toUserId: body.toUserId });
        if (!moved.moved) throw new RequestSecurityError(409, "This assignment was already changed. Refresh before reassigning it.");
        result.assigned = 1;
      } else {
        const userId = body.userId ?? session.user.id;
        await requireMember(userId);
        let slots: Array<{ matchKey: string; teamKey: string }>;
        if (body.action === "assign-range") {
          const range = expandAssignmentRange({ firstMatchKey: body.firstMatchKey, lastMatchKey: body.lastMatchKey, teamKey: body.teamKey,
            matchKeys: preview.slots.map(slot => slot.matchKey), schedule: preview.slots, qualsOnly: body.qualsOnly });
          if (!range.ok) throw new RequestSecurityError(400, range.error);
          slots = range.slots;
        } else { requireSlot(body.matchKey, body.teamKey); slots = [{ matchKey: body.matchKey, teamKey: body.teamKey }]; }
        for (const slot of slots) {
          const candidate = { userId, ...slot };
          const conflict = assignmentConflict(conflicts, candidate);
          if (conflict) {
            if (body.action === "assign") throw new RequestSecurityError(409, describeAssignmentConflict(conflict));
            result.refused.push(describeAssignmentConflict(conflict));
            continue;
          }
          const written = await assignCoverageSlot(client, { orgId, eventKey, ...candidate });
          if (written.inserted) result.assigned++; else result.unchanged++;
          conflicts = withAssignment(conflicts, candidate);
        }
      }
      const next = await computeScoutingCoverageView(client, query);
      if (next.status !== "live" || next.orgId !== orgId || next.eventKey !== eventKey) throw new Error("Assignment result could not be confirmed");
      return { ...next, assignmentResult: result, refused: result.refused };
    });
    return noStore(view);
  } catch (error) { return failure(error); }
}
