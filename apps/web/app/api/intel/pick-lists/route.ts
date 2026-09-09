import { withSavepoint } from "@vantage/db";
import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";
import { recordPickListInfluence } from "../../../../lib/scouting/pick-feedback";

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
      entries?: Array<{ teamKey: string; rank: number; tier?: string; notes?: string }>;
    };
    if (!body.eventKey || !body.name?.trim() || !Array.isArray(body.entries))
      return Response.json({ error: "eventKey, name, and entries are required" }, { status: 400 });
    const result = await withIntelRequest(body.orgId ?? null, async (client) => {
      const user = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      const userId = user.rows[0]!.id;
      const id = await new IntelResearchRepository(client).savePickList(body.orgId!, userId, {
        id: body.id,
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
            pickListId: id,
            listName: body.name!.trim(),
            entries: body.entries!,
            recordedBy: userId,
          }),
        { attributed: 0, notified: 0 },
      );
      return { id, influence };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return intelErrorResponse(error);
  }
}
