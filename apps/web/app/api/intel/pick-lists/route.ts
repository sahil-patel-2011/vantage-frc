import { withSavepoint } from "@vantage/db";
import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";
import { recordPickListInfluence } from "../../../../lib/scouting/pick-feedback";
import { assertScoutingLead } from "@vantage/scouting/permissions";
import { ensurePickList, listPickList, PickListSaveConflict, saveRankedPickList, upsertEntryFromTier } from "../../../../lib/picklist";
import { pickListRankingRequest } from "../../../../lib/picklist/ranking-request";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../../lib/security/request";

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const result = await withIntelRequest(orgId, (client) =>
      new IntelResearchRepository(client).listPickLists(
        orgId!,
        url.searchParams.get("eventKey") ?? undefined,
      ),
    );
    return privateJson({ pickLists: result });
  } catch (error) {
    return intelErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseSecureJson(request, pickListRankingRequest, { maxBytes: 1_048_576 });
    if (body.id && body.expectedRevision === undefined) throw new RequestSecurityError(409, "Refresh the saved pick list before saving so its current version can be checked.");
    const result = await withIntelRequest(body.orgId, async (client) => {
      await assertScoutingLead(client, body.orgId);
      const user = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      const userId = user.rows[0]!.id;
      let id: string;
      if (!body.id && body.expectedRevision === undefined) {
        // Compatibility for team-analysis shortcuts: add to the named list, never replace its ranking.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["pick-list-name", body.orgId, body.eventKey, body.name])]);
        id = await ensurePickList(client, { orgId: body.orgId, userId, eventKey: body.eventKey, name: body.name, source: "intel_research" });
        await client.query("SELECT id FROM pick_lists WHERE org_id=$1::uuid AND id=$2::uuid FOR UPDATE", [body.orgId, id]);
        const existing = await listPickList(client, { orgId: body.orgId, pickListId: id });
        const retained = new Set(existing?.entries.map(entry => entry.teamKey));
        for (const entry of body.entries) {
          if (retained.has(entry.teamKey)) continue;
          await upsertEntryFromTier(client, {
            orgId: body.orgId, userId, pickListId: id, teamKey: entry.teamKey, tier: entry.tier ?? null, notes: entry.notes,
          });
        }
      } else {
        id = await saveRankedPickList(client, {
          orgId: body.orgId, userId, id: body.id ?? crypto.randomUUID(), expectedRevision: body.expectedRevision!,
          eventKey: body.eventKey, name: body.name, entries: body.entries,
        });
      }
      const snapshot = await listPickList(client, { orgId: body.orgId, pickListId: id });
      if (!snapshot) throw new Error("Saved pick list could not be confirmed");
      // Influence tables may be mid-migrate. Savepointed so that stays true: the
      // bare catch it replaces aborted the transaction, so the pick list this
      // request had just saved was rolled back at COMMIT and the route still
      // answered 201 with its id — on an alliance-selection afternoon.
      const influence = await withSavepoint(
        client,
        () =>
          recordPickListInfluence(client, {
            orgId: body.orgId!,
            eventKey: body.eventKey!,
            pickListId: id,
            listName: body.name!.trim(),
            entries: snapshot.entries.filter(entry => body.entries.some(submitted => submitted.teamKey === entry.teamKey))
              .map(entry => ({ teamKey: entry.teamKey, rank: entry.rank, tier: entry.tier ?? undefined, notes: entry.notes ?? undefined })),
            recordedBy: userId,
          }),
        { attributed: 0, notified: 0 },
      );
      const pickList = { id, name: snapshot.list.name, eventKey: snapshot.list.eventKey, revision: snapshot.list.revision,
        status: snapshot.list.status, updatedAt: snapshot.list.updatedAt,
        entries: snapshot.entries.map(entry => ({ id: entry.id, teamKey: entry.teamKey, teamNumber: entry.teamNumber,
          nickname: entry.nickname, rank: entry.rank, tier: entry.tier, bucket: entry.bucket, notes: entry.notes })) };
      return { id, influence, pickList };
    });
    return privateJson(result, { status: 201 });
  } catch (error) {
    if (error instanceof PickListSaveConflict) return privateJson({ error: error.message }, { status: 409 });
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Pick list request failed");
    if (error && typeof error === "object" && "status" in error && error.status === 403) return privateJson({ error: "Scouting lead access required" }, { status: 403 });
    return intelErrorResponse(error);
  }
}
