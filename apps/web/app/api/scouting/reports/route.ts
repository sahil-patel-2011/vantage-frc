import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string;
      entryId?: string;
      type?: "match" | "pit";
      action?: string;
    };
    if (body.action !== "delete") {
      return Response.json({ error: "Unsupported action." }, { status: 400 });
    }
    if (!body.orgId || !body.entryId || (body.type !== "match" && body.type !== "pit")) {
      return Response.json({ error: "Choose a real scout report to delete." }, { status: 400 });
    }
    const deleted = await withScoutingRequest(body.orgId, (client) =>
      new ScoutingRepository(client).deleteEntry(body.orgId!, session.user.id, {
        entryId: body.entryId!,
        type: body.type!,
      }),
    );
    return Response.json({ ok: deleted });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
