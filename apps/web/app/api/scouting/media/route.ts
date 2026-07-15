import { auth } from "@vantage/core";
import { LocalMediaStorage } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string;
      clientId?: string;
      eventKey?: string;
      teamKey?: string;
      entryId?: string;
      kind?: "photo" | "video";
      contentType?: string;
      byteSize?: number;
      tags?: string[];
    };
    if (
      !body.clientId ||
      !body.orgId ||
      !body.eventKey ||
      !body.teamKey ||
      !body.kind ||
      !body.contentType ||
      typeof body.byteSize !== "number"
    ) {
      return Response.json({ error: "Invalid media metadata" }, { status: 400 });
    }
    const upload=await withScoutingRequest(body.orgId, async (client) => {
      const member=await client.query("SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2",[body.orgId,session.user.id]);
      if(!member.rowCount)throw new Error("Organization access denied");
      const prepared=await new LocalMediaStorage().createUpload({orgId:body.orgId!,clientId:body.clientId!,contentType:body.contentType!,byteSize:body.byteSize!});
      await client.query(
        `INSERT INTO scout_media
          (org_id,event_key,team_key,entry_id,client_id,kind,storage_key,
           content_type,byte_size,tags,captured_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (org_id,client_id) DO UPDATE SET updated_at=now()`,
        [
          body.orgId, body.eventKey, body.teamKey, body.entryId ?? null,
          body.clientId, body.kind, prepared.storageKey, body.contentType,
          body.byteSize, body.tags ?? [], session.user.id,
        ],
      );
      return prepared;
    });
    return Response.json(upload);
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
