import {
  isScoutMediaThumbColumnMissing,
  parseScoutMediaGetVariant,
  pickScoutMediaGetPayload,
} from "../../../../../lib/scouting/scout-media-preview";
import {
  hostedScoutMediaCapBytes,
  scoutMediaPutByteLimitError,
} from "../../../../../lib/scouting/prepare-scout-media";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../../lib/scouting-auth";

export async function PUT(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params;
    const orgId = new URL(request.url).searchParams.get("orgId");
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > hostedScoutMediaCapBytes()) {
      return Response.json(scoutMediaPutByteLimitError(declared), { status: 400 });
    }
    const content = Buffer.from(await request.arrayBuffer());
    const bodyLimit = scoutMediaPutByteLimitError(content.byteLength);
    if (bodyLimit) return Response.json(bodyLimit, { status: 400 });
    await withScoutingRequest(orgId, async (client) => {
      const updated = await client.query(
        `UPDATE scout_media
         SET status = 'uploaded',
             bytes = $3,
             byte_size = $4,
             updated_at = now()
         WHERE org_id = $1
           AND client_id = $2
           AND storage_key LIKE $1::text || '/%'
         RETURNING id`,
        [orgId, clientId, content, content.byteLength],
      );
      if (!updated.rowCount) {
        throw new Error("Media metadata not found for this organization");
      }
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

/** Serve org-isolated robot / pit media bytes to authenticated members. */
export async function GET(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params;
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const variant = parseScoutMediaGetVariant(url.searchParams.get("variant"));
    const row = await withScoutingRequest(orgId, async (client) => {
      try {
        const result = await client.query<{
          contentType: string;
          bytes: Buffer | null;
          thumbBytes: Buffer | null;
        }>(
          variant === "thumb"
            ? `SELECT 'image/jpeg' AS "contentType",
                      NULL::bytea AS bytes,
                      thumb_bytes AS "thumbBytes"
               FROM scout_media
               WHERE org_id = $1
                 AND client_id = $2
                 AND status = 'uploaded'
                 AND storage_key LIKE $1::text || '/%'
               LIMIT 1`
            : `SELECT content_type AS "contentType",
                      bytes,
                      NULL::bytea AS "thumbBytes"
               FROM scout_media
               WHERE org_id = $1
                 AND client_id = $2
                 AND status = 'uploaded'
                 AND storage_key LIKE $1::text || '/%'
               LIMIT 1`,
          [orgId, clientId],
        );
        return result.rows[0] ?? null;
      } catch (error) {
        if (variant === "thumb" && isScoutMediaThumbColumnMissing(error)) {
          return null;
        }
        throw error;
      }
    });
    const payload = pickScoutMediaGetPayload(row, variant);
    if (payload.status === "missing") {
      return Response.json({ error: payload.reason }, { status: 404 });
    }
    return new Response(Buffer.from(payload.body), {
      status: 200,
      headers: {
        "Content-Type": payload.contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
