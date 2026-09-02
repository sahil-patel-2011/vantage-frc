import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { headers } from "next/headers";
import {
  ScoutingHttpError,
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../../lib/scouting-auth";
import {
  MAX_SCOUT_PHOTO_INPUT_BYTES,
  ScoutPhotoError,
  normalizeScoutPhoto,
  scoutPhotoErrorStatus,
  sha256Hex,
} from "../../../../../lib/scout-media/normalize-scout-photo";
import {
  normalizeScoutMediaUsage,
  resolveScoutMediaQuota,
  scoutMediaQuotaExceededReason,
} from "../../../../../lib/scout-media/quota";
import { scoutMediaUrl } from "../../../../../lib/scout-media/client";

export const dynamic = "force-dynamic";

/** Mirrors MAX_SCOUT_MEDIA_BYTES in lib/scouting/media-downscale.ts. */
const MAX_SCOUT_MEDIA_BYTES = MAX_SCOUT_PHOTO_INPUT_BYTES;

/** Only these ever leave the server as a Content-Type; anything else is served opaque. */
const SERVABLE_CONTENT_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

const BYTE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  // Team-private bytes: never a shared cache. The SW keeps its own allow-listed copy.
  "cache-control": "private, max-age=3600",
} as const;

type RouteContext = { params: Promise<{ clientId: string }> };

type StoredMedia = {
  bytes: Buffer;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  thumb: Buffer | null;
  thumbContentType: string | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  checksumSha256: string;
};

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23505");
}

function safeFilename(clientId: string, contentType: string): string {
  const stem = clientId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "scout-media";
  return `${stem}.${EXTENSION_BY_TYPE[contentType] ?? "bin"}`;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((token) => token.trim().replace(/^W\//, ""))
    .some((token) => token === etag || token === "*");
}

async function findDuplicate(
  client: PoolClient,
  input: { orgId: string; eventKey: string; teamKey: string; checksum: string; clientId: string },
): Promise<string | null> {
  const existing = await client.query<{ clientId: string }>(
    `SELECT client_id AS "clientId"
     FROM scout_media
     WHERE org_id = $1::uuid
       AND event_key = $2
       AND team_key = $3
       AND checksum_sha256 = $4
       AND deleted_at IS NULL
       AND client_id <> $5
     LIMIT 1`,
    [input.orgId, input.eventKey, input.teamKey, input.checksum, input.clientId],
  );
  return existing.rows[0]?.clientId ?? null;
}

/** Drop the pending shell row for a byte-identical retake (own row — DELETE policy). */
async function dropPendingRow(client: PoolClient, orgId: string, clientId: string) {
  await client.query(
    `DELETE FROM scout_media
     WHERE org_id = $1::uuid AND client_id = $2 AND status = 'pending' AND bytes IS NULL`,
    [orgId, clientId],
  );
}

/**
 * Serialize this org's uploads and enforce the item / byte quota inside the
 * withRls transaction. Advisory lock is transaction-scoped, so a missing quota
 * row (defaults) still gets a real lock instead of SELECT … FOR UPDATE on nothing.
 */
async function assertQuotaFits(
  client: PoolClient,
  orgId: string,
  clientId: string,
  incomingBytes: number,
) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('scout_media_quota:' || $1::text))`, [orgId]);
  const quotaRow = await client.query<{ maxItems: number; maxBytes: string }>(
    `SELECT max_items AS "maxItems", max_bytes::text AS "maxBytes"
     FROM scout_media_quota WHERE org_id = $1::uuid`,
    [orgId],
  );
  const usageRow = await client.query<{ items: number; bytes: string }>(
    `SELECT count(*)::int AS items,
            COALESCE(SUM(byte_size + COALESCE(octet_length(thumb_bytes), 0)), 0)::text AS bytes
     FROM scout_media
     WHERE org_id = $1::uuid
       AND status = 'uploaded'
       AND deleted_at IS NULL
       AND client_id <> $2`,
    [orgId, clientId],
  );
  const reason = scoutMediaQuotaExceededReason(
    normalizeScoutMediaUsage(usageRow.rows[0]),
    resolveScoutMediaQuota(quotaRow.rows[0]),
    incomingBytes,
  );
  if (reason) throw new ScoutingHttpError(507, reason);
}

/**
 * Receive the bytes for a pending scout_media row. Photos are normalized
 * (EXIF-oriented, stripped, WebP ≤1600px + 320px thumb, sha256); video/audio
 * are stored as declared. Byte-identical retakes answer {duplicate:true}.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { clientId } = await context.params;
    const orgId = new URL(request.url).searchParams.get("orgId");
    const content = Buffer.from(await request.arrayBuffer());
    if (!content.byteLength) {
      return Response.json({ error: "Media upload was empty" }, { status: 400 });
    }
    if (content.byteLength > MAX_SCOUT_MEDIA_BYTES) {
      return Response.json(
        {
          error: `Media is ${(content.byteLength / (1024 * 1024)).toFixed(1)} MB — over the ${Math.round(MAX_SCOUT_MEDIA_BYTES / (1024 * 1024))} MB upload limit.`,
        },
        { status: 413 },
      );
    }

    const outcome = await withScoutingRequest(orgId, async (client) => {
      const pending = await client.query<{
        id: string;
        kind: string;
        eventKey: string;
        teamKey: string;
        contentType: string;
        status: string;
        deletedAt: string | null;
      }>(
        `SELECT id, kind::text AS kind, event_key AS "eventKey", team_key AS "teamKey",
                content_type AS "contentType", status::text AS status, deleted_at::text AS "deletedAt"
         FROM scout_media
         WHERE org_id = $1::uuid
           AND client_id = $2
           AND storage_key LIKE $1::text || '/%'
         LIMIT 1
         FOR UPDATE`,
        [orgId, clientId],
      );
      const row = pending.rows[0];
      if (!row) throw new ScoutingHttpError(404, "Media metadata not found for this organization");
      if (row.deletedAt) throw new ScoutingHttpError(410, "This photo was deleted from the team's pit media");

      let stored: StoredMedia;
      if (row.kind === "photo") {
        try {
          const normalized = await normalizeScoutPhoto(content);
          stored = {
            bytes: normalized.full,
            contentType: normalized.contentType,
            byteSize: normalized.byteSize,
            width: normalized.width,
            height: normalized.height,
            thumb: normalized.thumb,
            thumbContentType: normalized.thumbContentType,
            thumbWidth: normalized.thumbWidth,
            thumbHeight: normalized.thumbHeight,
            checksumSha256: normalized.checksumSha256,
          };
        } catch (error) {
          if (error instanceof ScoutPhotoError) {
            throw new ScoutingHttpError(scoutPhotoErrorStatus(error), error.message);
          }
          throw error;
        }
      } else {
        stored = {
          bytes: content,
          contentType: row.contentType,
          byteSize: content.byteLength,
          width: null,
          height: null,
          thumb: null,
          thumbContentType: null,
          thumbWidth: null,
          thumbHeight: null,
          checksumSha256: sha256Hex(content),
        };
      }

      const duplicateOf = await findDuplicate(client, {
        orgId: orgId!,
        eventKey: row.eventKey,
        teamKey: row.teamKey,
        checksum: stored.checksumSha256,
        clientId,
      });
      if (duplicateOf) {
        if (row.status === "pending") await dropPendingRow(client, orgId!, clientId);
        return { duplicate: true as const, clientId: duplicateOf, requestedClientId: clientId };
      }

      await assertQuotaFits(client, orgId!, clientId, stored.byteSize + (stored.thumb?.byteLength ?? 0));

      await client.query("SAVEPOINT scout_media_store");
      try {
        await client.query(
          `UPDATE scout_media
           SET status = 'uploaded',
               bytes = $3,
               byte_size = $4,
               content_type = $5,
               width = $6,
               height = $7,
               thumb_bytes = $8,
               thumb_content_type = $9,
               thumb_width = $10,
               thumb_height = $11,
               checksum_sha256 = $12,
               updated_at = now()
           WHERE org_id = $1::uuid AND client_id = $2`,
          [
            orgId,
            clientId,
            stored.bytes,
            stored.byteSize,
            stored.contentType,
            stored.width,
            stored.height,
            stored.thumb,
            stored.thumbContentType,
            stored.thumbWidth,
            stored.thumbHeight,
            stored.checksumSha256,
          ],
        );
        await client.query("RELEASE SAVEPOINT scout_media_store");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT scout_media_store");
        if (!isUniqueViolation(error)) throw error;
        // Two scouts uploaded the same retake at once — the other one won.
        const winner = await findDuplicate(client, {
          orgId: orgId!,
          eventKey: row.eventKey,
          teamKey: row.teamKey,
          checksum: stored.checksumSha256,
          clientId,
        });
        if (!winner) throw error;
        if (row.status === "pending") await dropPendingRow(client, orgId!, clientId);
        return { duplicate: true as const, clientId: winner, requestedClientId: clientId };
      }

      return {
        duplicate: false as const,
        clientId,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        width: stored.width,
        height: stored.height,
        hasThumb: Boolean(stored.thumb),
        checksumSha256: stored.checksumSha256,
      };
    });

    if (outcome.duplicate) {
      return Response.json({
        ok: true,
        duplicate: true,
        clientId: outcome.clientId,
        requestedClientId: outcome.requestedClientId,
        url: scoutMediaUrl(orgId!, outcome.clientId),
        thumbUrl: scoutMediaUrl(orgId!, outcome.clientId, "thumb"),
      });
    }
    return Response.json({
      ok: true,
      ...outcome,
      url: scoutMediaUrl(orgId!, clientId),
      thumbUrl: outcome.hasThumb ? scoutMediaUrl(orgId!, clientId, "thumb") : null,
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

/**
 * Serve org-isolated media bytes to authenticated members.
 * `?variant=thumb` returns the stored thumbnail (falls back to the full for
 * legacy rows without one). ETag is the stored checksum; 304 on If-None-Match.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { clientId } = await context.params;
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const wantThumb = url.searchParams.get("variant") === "thumb";

    const served = await withScoutingRequest(orgId, async (client) => {
      const meta = await client.query<{
        contentType: string;
        thumbContentType: string | null;
        hasThumb: boolean;
        checksum: string | null;
      }>(
        `SELECT content_type AS "contentType",
                thumb_content_type AS "thumbContentType",
                (thumb_bytes IS NOT NULL) AS "hasThumb",
                checksum_sha256 AS checksum
         FROM scout_media
         WHERE org_id = $1::uuid
           AND client_id = $2
           AND status = 'uploaded'
           AND deleted_at IS NULL
           AND storage_key LIKE $1::text || '/%'
         LIMIT 1`,
        [orgId, clientId],
      );
      const row = meta.rows[0];
      if (!row) return null;
      const useThumb = wantThumb && row.hasThumb;
      const contentType = (useThumb ? row.thumbContentType : row.contentType) ?? "application/octet-stream";
      const etag = row.checksum ? `"${row.checksum}${useThumb ? "-thumb" : ""}"` : null;
      if (etag && etagMatches(request.headers.get("if-none-match"), etag)) {
        return { notModified: true as const, etag, contentType, useThumb };
      }
      const bytesResult = await client.query<{ bytes: Buffer | null }>(
        `SELECT CASE WHEN $3::boolean THEN thumb_bytes ELSE bytes END AS bytes
         FROM scout_media
         WHERE org_id = $1::uuid AND client_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [orgId, clientId, useThumb],
      );
      const bytes = bytesResult.rows[0]?.bytes;
      if (!bytes) return null;
      return {
        notModified: false as const,
        bytes,
        contentType,
        useThumb,
        etag: etag ?? `"${sha256Hex(bytes)}${useThumb ? "-thumb" : ""}"`,
      };
    });

    if (!served) return Response.json({ error: "Media not found" }, { status: 404 });
    const contentType = SERVABLE_CONTENT_TYPES.has(served.contentType)
      ? served.contentType
      : "application/octet-stream";
    const common = {
      ...BYTE_HEADERS,
      etag: served.etag,
      "x-scout-media-variant": served.useThumb ? "thumb" : "full",
    };
    if (served.notModified) {
      return new Response(null, { status: 304, headers: common });
    }
    const body = new ArrayBuffer(served.bytes.byteLength);
    new Uint8Array(body).set(served.bytes);
    return new Response(body, {
      status: 200,
      headers: {
        ...common,
        "content-type": contentType,
        "content-length": String(served.bytes.byteLength),
        "content-disposition": `inline; filename="${safeFilename(clientId, contentType)}"`,
      },
    });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

/**
 * Soft delete — the capturer or an owner/admin. Bytes and thumb are NULLed
 * immediately; the row stays (deleted_at/deleted_by) so the entry link and
 * dedupe history remain auditable.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const { clientId } = await context.params;
    const orgId = new URL(request.url).searchParams.get("orgId");

    const result = await withScoutingRequest(orgId, async (client) => {
      const existing = await client.query<{
        capturedBy: string;
        deletedAt: string | null;
      }>(
        `SELECT captured_by AS "capturedBy", deleted_at::text AS "deletedAt"
         FROM scout_media
         WHERE org_id = $1::uuid AND client_id = $2
         LIMIT 1`,
        [orgId, clientId],
      );
      const row = existing.rows[0];
      if (!row) throw new ScoutingHttpError(404, "Media not found");
      if (row.deletedAt) return { alreadyDeleted: true };

      const membership = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      const role = membership.rows[0]?.role ?? "";
      const allowed =
        row.capturedBy === session.user.id || role === "owner" || role === "admin";
      if (!allowed) {
        throw new ScoutingHttpError(
          403,
          "Only the scout who took this photo or a team owner/admin can delete it",
        );
      }

      const updated = await client.query(
        `UPDATE scout_media
         SET deleted_at = now(),
             deleted_by = $3::uuid,
             bytes = NULL,
             thumb_bytes = NULL,
             updated_at = now()
         WHERE org_id = $1::uuid AND client_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [orgId, clientId, session.user.id],
      );
      if (!updated.rowCount) {
        throw new ScoutingHttpError(403, "Organization access denied");
      }
      return { alreadyDeleted: false };
    });

    return Response.json({ ok: true, clientId, deleted: true, alreadyDeleted: result.alreadyDeleted });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
