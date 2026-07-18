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
      let influence = { attributed: 0, notified: 0 };
      try {
        influence = await recordPickListInfluence(client, {
          orgId: body.orgId!,
          eventKey: body.eventKey!,
          pickListId: id,
          listName: body.name!.trim(),
          entries: body.entries!,
          recordedBy: userId,
        });
      } catch {
        // Influence tables may be mid-migrate; pick list save still succeeds.
      }
      return { id, influence };
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return intelErrorResponse(error);
  }
}
