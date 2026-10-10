import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";
import { assertScoutingLead } from "@vantage/scouting/permissions";
import { classifyDbError } from "../../../lib/db-error";
import { withIntelRequest, IntelHttpError } from "../../../lib/intel-auth";
import { PickListSaveConflict, setEntryNotes } from "../../../lib/picklist";
import { collabMutationRequest } from "../../../lib/picklist-collab/mutation-request";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../lib/security/request";
import {
  addEntry, castVote, computePicklistCollabView, createList, currentSeasonYear, deleteEntry,
  moveEntry, removeVote, setEntryOrder, updateListStatus, type PicklistCollabView,
} from "../../../lib/picklist-collab/compute-picklist-collab";
export type { PicklistCollabView };

function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
}
function errorResponse(error: unknown) {
  if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Pick list request failed");
  if (error instanceof IntelHttpError || error instanceof PickListSaveConflict) return privateJson({ error: error.message }, error.status);
  if (error && typeof error === "object" && "status" in error && error.status === 403) return privateJson({ error: "Scouting lead access required" }, 403);
  const friendly = classifyDbError(error) ?? classifyDbError(error instanceof Error ? error.cause : undefined);
  if (friendly) return privateJson({ error: friendly.message }, friendly.status);
  return privateJson({ error: "Pick list is temporarily unavailable. Refresh to check the saved result before retrying." }, 503);
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return privateJson({ error: "Your session ended. Sign in again." }, 401);
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const listId = url.searchParams.get("listId");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if ((orgId && !uuid.test(orgId)) || (listId && !uuid.test(listId))) return privateJson({ error: "Choose a valid team and pick list." }, 400);
    const view = await withRls({ userId: session.user.id }, async client => {
      const result = await computePicklistCollabView(client, { userId: session.user.id, requestedOrg: orgId, listId });
      if (orgId && !result.orgId) throw new IntelHttpError(403, "Team access changed. Choose a team you belong to.");
      if (result.orgId) {
        try {
          await assertOrgAuthentication(client, { userId: session.user.id, orgId: result.orgId, sessionId: session.session.id,
            authMethod: String((session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown"),
            rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value });
        } catch { throw new IntelHttpError(403, "Your team's authentication requirements changed. Sign in again."); }
      }
      if (listId && (result.status !== "live" || result.activeList?.id !== listId)) throw new IntelHttpError(404, "This pick list is no longer available. Choose another saved list.");
      return result;
    });
    return privateJson(view);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await parseSecureJson(request, collabMutationRequest, { maxBytes: 131_072 });
    const view = await withIntelRequest(body.orgId, async client => {
      const actor = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      const userId = actor.rows[0]?.id;
      if (!userId) throw new IntelHttpError(401, "Your session ended. Sign in again.");
      const vote = body.action === "cast-vote" || body.action === "remove-vote";
      if (!vote) await assertScoutingLead(client, body.orgId);
      let listId = body.listId;
      if (body.action === "create-list") {
        const eventKey = body.eventKey ?? (await client.query<{ eventKey: string | null }>(
          'SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id=$1::uuid', [body.orgId],
        )).rows[0]?.eventKey;
        if (!eventKey) throw new RequestSecurityError(422, "Choose the active event before creating a pick list.");
        listId = await createList(client, { orgId: body.orgId, userId, eventKey, name: body.name, seasonYear: body.seasonYear ?? currentSeasonYear() });
      } else {
        if (!listId) throw new RequestSecurityError(409, "Refresh and open a saved pick list before changing it.");
        const locked = await client.query<{ status: string; revision: string | number }>(
          "SELECT status,revision FROM pick_lists WHERE org_id=$1::uuid AND id=$2::uuid FOR UPDATE", [body.orgId, listId],
        );
        const list = locked.rows[0];
        if (!list) throw new IntelHttpError(404, "This pick list is no longer available.");
        if (!vote && (body.expectedRevision === undefined || body.expectedRevision !== Number(list.revision))) throw new PickListSaveConflict("This list changed. Your inputs are retained. Refresh the saved list before trying again.");
        if (body.action !== "update-list-status" && list.status !== "open") throw new PickListSaveConflict(`This list is ${list.status}. A scouting lead can reopen it before edits or votes.`);
        if ("entryId" in body) {
          const entry = await client.query("SELECT 1 FROM pick_list_entries WHERE org_id=$1::uuid AND pick_list_id=$2::uuid AND id=$3::uuid", [body.orgId, listId, body.entryId]);
          if (!entry.rowCount) throw new IntelHttpError(404, "This team is no longer on the selected list.");
        }
        switch (body.action) {
          case "update-list-status": await updateListStatus(client, { orgId: body.orgId, userId, listId, status: body.status }); break;
          case "add-entry": {
            const existing = await client.query("SELECT 1 FROM pick_list_entries WHERE org_id=$1::uuid AND pick_list_id=$2::uuid AND team_key=$3", [body.orgId, listId, `frc${body.teamNumber}`]);
            if (existing.rowCount) throw new PickListSaveConflict("This team is already on the list. Its ranking and notes have been kept.");
            await addEntry(client, { orgId: body.orgId, userId, listId, teamNumber: body.teamNumber, teamName: body.teamName ?? null, tier: body.tier ?? "unranked", note: body.note ?? null }); break;
          }
          case "move-entry": await moveEntry(client, { orgId: body.orgId, userId, listId, entryId: body.entryId, tier: body.tier, position: body.position }); break;
          case "set-order": {
            const ids = body.order.flatMap(group => group.entryIds);
            const owned = await client.query("SELECT id FROM pick_list_entries WHERE org_id=$1::uuid AND pick_list_id=$2::uuid AND id=ANY($3::uuid[])", [body.orgId, listId, ids]);
            if (owned.rowCount !== ids.length) throw new PickListSaveConflict("The teams on this list changed. Refresh before saving the order.");
            await setEntryOrder(client, { orgId: body.orgId, userId, listId, groups: body.order }); break;
          }
          case "delete-entry": await deleteEntry(client, { orgId: body.orgId, userId, listId, entryId: body.entryId }); break;
          case "set-entry-notes": await setEntryNotes(client, { orgId: body.orgId, userId, pickListId: listId, entryId: body.entryId, notes: body.note }); break;
          case "cast-vote": await castVote(client, { orgId: body.orgId, userId, listId, entryId: body.entryId, weight: body.weight ?? 1, rankSuggestion: body.rankSuggestion ?? null, comment: body.comment ?? null }); break;
          case "remove-vote": await removeVote(client, { orgId: body.orgId, userId, listId, entryId: body.entryId }); break;
        }
      }
      const result = await computePicklistCollabView(client, { userId, requestedOrg: body.orgId, listId });
      if (result.status !== "live" || result.activeList?.id !== listId) throw new Error("Save result could not be confirmed");
      return result;
    });
    return privateJson(view);
  } catch (error) { return errorResponse(error); }
}
