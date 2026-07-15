import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";

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
    const id = await withIntelRequest(body.orgId ?? null, async (client) => {
      const user = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      return new IntelResearchRepository(client).savePickList(
        body.orgId!,
        user.rows[0]!.id,
        {
          id: body.id,
          eventKey: body.eventKey!,
          name: body.name!,
          entries: body.entries!,
        },
      );
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return intelErrorResponse(error);
  }
}
