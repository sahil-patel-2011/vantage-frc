import { auth } from "@vantage/core";
import { LocalMediaStorage } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";
import { MAX_SCOUT_PHOTO_INPUT_BYTES } from "../../../../lib/scout-media/normalize-scout-photo";
import { scoutMediaUrl } from "../../../../lib/scout-media/client";

export const dynamic = "force-dynamic";

/** Mirrors MAX_SCOUT_MEDIA_BYTES in lib/scouting/media-downscale.ts. */
const MAX_SCOUT_MEDIA_BYTES = MAX_SCOUT_PHOTO_INPUT_BYTES;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Register a pending media row (metadata only) and hand back the PUT URL.
 * Size is validated here so an over-cap file never leaves a pending shell
 * behind; `entryClientId` links the photo to its offline entry before the
 * entry itself has synced (repository.syncEntry resolves it to entry_id).
 */
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
      entryClientId?: string | null;
      kind?: "photo" | "video" | "audio";
      contentType?: string;
      byteSize?: number;
      transcript?: string | null;
      tags?: string[];
    };
    const clientId = cleanText(body.clientId, 200);
    const eventKey = cleanText(body.eventKey, 40);
    const teamKey = cleanText(body.teamKey, 20);
    const contentType = cleanText(body.contentType, 120);
    if (
      !clientId ||
      !body.orgId ||
      !eventKey ||
      !teamKey ||
      !body.kind ||
      !contentType ||
      typeof body.byteSize !== "number" ||
      !Number.isFinite(body.byteSize)
    ) {
      return Response.json({ error: "Invalid media metadata" }, { status: 400 });
    }
    if (body.kind !== "photo" && body.kind !== "video" && body.kind !== "audio") {
      return Response.json({ error: "Invalid media kind" }, { status: 400 });
    }
    const byteSize = Math.floor(body.byteSize);
    if (byteSize < 1) {
      return Response.json({ error: "Media must contain at least 1 byte" }, { status: 400 });
    }
    if (byteSize > MAX_SCOUT_MEDIA_BYTES) {
      return Response.json(
        {
          error: `Media is ${(byteSize / (1024 * 1024)).toFixed(1)} MB — over the ${Math.round(MAX_SCOUT_MEDIA_BYTES / (1024 * 1024))} MB upload limit. Retake or trim it, then retry.`,
        },
        { status: 413 },
      );
    }
    if (body.kind === "photo" && !contentType.startsWith("image/")) {
      return Response.json({ error: "Photos must be image/* uploads" }, { status: 415 });
    }
    const entryId = typeof body.entryId === "string" && UUID_RE.test(body.entryId) ? body.entryId : null;
    const entryClientId = cleanText(body.entryClientId, 200);
    const transcript =
      typeof body.transcript === "string" && body.transcript.trim()
        ? body.transcript.trim()
        : null;
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= 80).slice(0, 24)
      : [];

    const orgId = body.orgId;
    const upload = await withScoutingRequest(orgId, async (client) => {
      const member = await client.query(
        "SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid",
        [orgId, session.user.id],
      );
      if (!member.rowCount) throw new Error("Organization access denied");
      const prepared = await new LocalMediaStorage().createUpload({
        orgId,
        clientId,
        contentType,
        byteSize,
      });
      const inserted = await client.query<{ status: string; hasBytes: boolean; deleted: boolean }>(
        `INSERT INTO scout_media
          (org_id, event_key, team_key, entry_id, entry_client_id, client_id, kind, storage_key,
           content_type, byte_size, transcript, tags, captured_by)
         VALUES (
           $1::uuid, $2, $3,
           COALESCE(
             $4::uuid,
             (SELECT id FROM pit_scout_entries WHERE org_id = $1::uuid AND client_id = $5
              UNION ALL
              SELECT id FROM match_scout_entries WHERE org_id = $1::uuid AND client_id = $5
              LIMIT 1)
           ),
           $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::uuid
         )
         ON CONFLICT (org_id, client_id) DO UPDATE SET
           transcript = COALESCE(EXCLUDED.transcript, scout_media.transcript),
           entry_client_id = COALESCE(EXCLUDED.entry_client_id, scout_media.entry_client_id),
           entry_id = COALESCE(scout_media.entry_id, EXCLUDED.entry_id),
           updated_at = now()
         RETURNING status::text AS status,
                   (bytes IS NOT NULL) AS "hasBytes",
                   (deleted_at IS NOT NULL) AS deleted`,
        [
          orgId, eventKey, teamKey, entryId, entryClientId, clientId, body.kind,
          prepared.storageKey, contentType, byteSize, transcript, tags, session.user.id,
        ],
      );
      const row = inserted.rows[0];
      return {
        ...prepared,
        clientId,
        alreadyUploaded: Boolean(row?.hasBytes && row.status === "uploaded" && !row.deleted),
        deleted: Boolean(row?.deleted),
        url: scoutMediaUrl(orgId, clientId),
        thumbUrl: body.kind === "photo" ? scoutMediaUrl(orgId, clientId, "thumb") : null,
      };
    });
    return Response.json(upload);
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
