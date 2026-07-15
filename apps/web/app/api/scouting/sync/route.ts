import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
import type { SyncEntry } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as { orgId?: string; entries?: SyncEntry[] };
    if (!Array.isArray(body.entries) || body.entries.length > 100) {
      return Response.json({ error: "entries must contain at most 100 items" }, { status: 400 });
    }
    const acknowledgements = await withScoutingRequest(body.orgId ?? null, async (client) => {
      const repository = new ScoutingRepository(client);
      const results = [];
      for (const entry of body.entries!) {
        results.push(await repository.syncEntry(body.orgId!, session.user.id, entry));
      }
      return results;
    });
    return Response.json({ acknowledgements });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
