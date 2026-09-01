import { auth } from "@vantage/core";
import { LocalMediaStorage } from "@vantage/scouting";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import {
  pickMintedEntryId,
  readScoutMediaLinkFromPost,
  withEntryClientTag,
} from "../../../../lib/scouting/attach-media-wire";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

async function lookupMintedEntryId(
  client: PoolClient,
  orgId: string,
  entryClientId: string,
): Promise<string | null> {
  const found = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM pit_scout_entries
     WHERE org_id = $1::uuid AND client_id = $2
     UNION ALL
     SELECT id::text AS id FROM match_scout_entries
     WHERE org_id = $1::uuid AND client_id = $2
     LIMIT 1`,
    [orgId, entryClientId],
  );
  return pickMintedEntryId({ lookedUpEntryId: found.rows[0]?.id ?? null });
}

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
      entryClientId?: string;
      kind?: "photo" | "video" | "audio";
      contentType?: string;
      byteSize?: number;
      transcript?: string | null;
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
    if (body.kind !== "photo" && body.kind !== "video" && body.kind !== "audio") {
      return Response.json({ error: "Invalid media kind" }, { status: 400 });
    }
    const transcript =
      typeof body.transcript === "string" && body.transcript.trim()
        ? body.transcript.trim()
        : null;
    const link = readScoutMediaLinkFromPost(body);
    const upload=await withScoutingRequest(body.orgId, async (client) => {
      const member=await client.query("SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2",[body.orgId,session.user.id]);
      if(!member.rowCount)throw new Error("Organization access denied");
      const prepared=await new LocalMediaStorage().createUpload({orgId:body.orgId!,clientId:body.clientId!,contentType:body.contentType!,byteSize:body.byteSize!});
      const lookedUp =
        !link.entryId && link.entryClientId
          ? await lookupMintedEntryId(client, body.orgId!, link.entryClientId)
          : null;
      const entryId = pickMintedEntryId({
        entryId: link.entryId,
        lookedUpEntryId: lookedUp,
      });
      const tags = link.entryClientId
        ? withEntryClientTag(body.tags ?? [], link.entryClientId)
        : [...(body.tags ?? [])];
      await client.query(
        `INSERT INTO scout_media
          (org_id,event_key,team_key,entry_id,client_id,kind,storage_key,
           content_type,byte_size,transcript,tags,captured_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (org_id,client_id) DO UPDATE SET
           transcript=COALESCE(EXCLUDED.transcript, scout_media.transcript),
           entry_id=COALESCE(scout_media.entry_id, EXCLUDED.entry_id),
           updated_at=now()`,
        [
          body.orgId, body.eventKey, body.teamKey, entryId,
          body.clientId, body.kind, prepared.storageKey, body.contentType,
          body.byteSize, transcript, tags, session.user.id,
        ],
      );
      return prepared;
    });
    return Response.json(upload);
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
