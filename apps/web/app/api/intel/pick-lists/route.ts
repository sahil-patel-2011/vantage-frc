import { withSavepoint } from "@vantage/db";
import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";
import { recordPickListInfluence } from "../../../../lib/scouting/pick-feedback";
import { saveRankedList, PickListSaveError } from "../../../../lib/picklist";

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
    return Response.json({ pickLists: result });
  } catch (error) {
    return intelErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      orgId?: string;
      id?: string;
      eventKey?: string;
      name?: string;
      baseRevision?: number;
      entries?: Array<{ teamKey: string; rank: number; tier?: string; notes?: string }>;
    };
    if (!body || typeof body !== "object" || typeof body.eventKey !== "string" || !body.eventKey.trim() || typeof body.name !== "string" || !body.name.trim() || !Array.isArray(body.entries))
      return Response.json({ error: "eventKey, name, and entries are required" }, { status: 400 });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof body.orgId !== "string" || !uuid.test(body.orgId) || (body.id !== undefined && (typeof body.id !== "string" || !uuid.test(body.id))) ||
      (body.baseRevision !== undefined && (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 1)) ||
      body.entries.length > 500 || body.name.length > 200 || body.eventKey.length > 64 ||
      body.entries.some(entry => !entry || typeof entry.teamKey !== "string" || !/^frc[1-9]\d{0,5}$/.test(entry.teamKey) ||
        !Number.isSafeInteger(entry.rank) || entry.rank < 1 || entry.rank > 500 ||
        (entry.tier !== undefined && (typeof entry.tier !== "string" || entry.tier.length > 40)) ||
        (entry.notes !== undefined && (typeof entry.notes !== "string" || entry.notes.length > 5000))) ||
      new Set(body.entries.map(entry => entry.teamKey)).size !== body.entries.length ||
      new Set(body.entries.map(entry => entry.rank)).size !== body.entries.length) {
      return Response.json({ error: "Choose a valid team and list with unique robots and ranks." }, { status: 400 });
    }
    const result = await withIntelRequest(body.orgId ?? null, async (client) => {
      const user = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      const userId = user.rows[0]!.id;
      const saved = await saveRankedList(client, {
        orgId: body.orgId!, userId,
        id: body.id,
        baseRevision: body.baseRevision,
        eventKey: body.eventKey!,
        name: body.name!,
        entries: body.entries!,
      });
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
            pickListId: saved.id,
            listName: body.name!.trim(),
            entries: body.entries!,
            recordedBy: userId,
          }),
        { attributed: 0, notified: 0 },
      );
      return { ...saved, influence };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PickListSaveError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    return intelErrorResponse(error);
  }
}
